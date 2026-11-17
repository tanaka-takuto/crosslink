import { basename, dirname, relative, resolve, sep } from "node:path";
import { inspectConfirmation } from "../domain/confirmation.js";
import { CrosslinkError, problem, type Problem } from "../domain/errors.js";
import {
  canonicalDefinition,
  inspectionProblems,
  type Group,
  type Role,
  type SelectorRoles,
} from "../domain/group.js";
import type { CrosslinkPorts, Settings } from "./ports.js";

export interface Inspection {
  file: string;
  name: string;
  reason: string;
  status: "confirmed" | "unconfirmed";
  files: { path: string; hash: string | null; changed: boolean | null; role?: Role }[];
  roles?: SelectorRoles;
  sourceChanges?: string[] | null;
  reviewTargets?: string[] | null;
  globs?: string[];
  added?: string[] | null;
  removed?: { path: string; hash: string; role?: Role }[] | null;
  membershipComplete?: boolean;
  /** False if reading or revalidating the definition failed; omitted on ordinary inspections. */
  definitionVerified?: boolean;
  snapshot: string | null;
  errors: Problem[];
}

function selectMembers(
  file: string,
  group: Group,
  ports: CrosslinkPorts,
): { members: string[]; roles: Map<string, Role>; errors: Problem[]; complete: boolean } {
  const role = (kind: "files" | "globs", selector: string): Role =>
    group.roles && Object.hasOwn(group.roles[kind], selector)
      ? group.roles[kind][selector]!
      : "both";
  const selected = new Map<string, { path: string; role: Role }>();
  const add = (member: string, role: Role) => {
    const target = resolve(dirname(file), member);
    const old = selected.get(target);
    if (old) old.role = old.role === role ? role : "both";
    else selected.set(target, { path: relative(dirname(file), target).split(sep).join("/"), role });
  };
  const errors: Problem[] = [];
  const fixed = new Set<string>();
  for (const member of group.files) {
    const path = resolve(dirname(file), member);
    if (fixed.has(path))
      errors.push({
        code: "DUPLICATE_MEMBER",
        message: `The same resolved fixed path is registered more than once: ${member}`,
      });
    fixed.add(path);
    add(member, role("files", member));
  }
  let complete = true;
  for (const pattern of [...new Set(group.globs ?? [])].sort()) {
    try {
      const matches = ports.files.expandGlob(pattern, dirname(file));
      if (!matches.length)
        errors.push({
          code: "GLOB_NO_MATCH",
          message: `Glob matches no files: ${pattern}. Add matching files or edit the selector, then run check and read all related files before confirming.`,
        });
      for (const match of matches) add(match, role("globs", pattern));
    } catch (error) {
      complete = false;
      errors.push(problem(error));
    }
  }
  // 固定パスの表記は既存形式のhash key契約を保つ。同じ解決パスのglob重複は一件。
  for (const member of group.files) selected.get(resolve(dirname(file), member))!.path = member;
  const entries = [...selected.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return {
    members: entries.map((entry) => entry.path),
    roles: new Map(entries.map((entry) => [entry.path, entry.role])),
    errors,
    complete,
  };
}

export function inspectionSnapshot(file: string, raw: string, files: Inspection["files"]): string {
  return JSON.stringify({
    file,
    raw,
    files: files.map((entry) =>
      entry.role ? [entry.path, entry.hash, entry.role] : [entry.path, entry.hash],
    ),
  });
}

export function inspectGroup(file: string, ports: CrosslinkPorts, settings: Settings): Inspection {
  file = resolve(file);
  const result: Inspection = {
    file,
    name: basename(file),
    reason: "",
    status: "unconfirmed",
    files: [],
    definitionVerified: false,
    snapshot: null,
    errors: [],
  };
  try {
    const { group, raw } = ports.groups.read(file);
    delete result.definitionVerified;
    result.name = group.name;
    result.reason = group.reason;
    const selection = selectMembers(file, group, ports);
    result.errors.push(...selection.errors, ...inspectionProblems(group, selection.members.length));
    if (group.roles) {
      result.roles = group.roles;
      result.reviewTargets = selection.members.filter(
        (path) => selection.roles.get(path) !== "source-only",
      );
      for (const [side, excluded] of [
        ["source", "target-only"],
        ["target", "source-only"],
      ] as const)
        if (!selection.members.some((path) => selection.roles.get(path) !== excluded))
          result.errors.push({
            code: "MISSING_ROLE",
            message: `At least one effective ${side} is required. Edit selector roles, then inspect and read all related files before confirming.`,
          });
    }
    if (group.globs?.length) {
      result.globs = [...new Set(group.globs)].sort();
      result.membershipComplete = selection.complete;
      const baseline = group.confirmation?.hashes;
      result.added =
        baseline && selection.complete
          ? selection.members.filter((member) => !Object.hasOwn(baseline, member))
          : null;
      result.removed =
        baseline && selection.complete
          ? Object.keys(baseline)
              .sort()
              .filter((member) => !selection.members.includes(member))
              .map((path) => ({
                path,
                hash: baseline[path]!,
                ...(group.roles ? { role: group.confirmation!.roles![path]! } : {}),
              }))
          : null;
    }
    const identities = new Set<string>();
    const observed = new Map<string, { hash: string; identity: string }>();
    for (const member of selection.members) {
      const entry: Inspection["files"][number] = {
        path: member,
        hash: null,
        changed: null,
        ...(group.roles ? { role: selection.roles.get(member)! } : {}),
      };
      result.files.push(entry);
      try {
        const target = resolve(dirname(file), member);
        if (ports.files.isManagementFile(target, file, settings))
          throw new CrosslinkError(
            "MANAGEMENT_FILE",
            `Management files cannot be group members: ${member}`,
          );
        const current = ports.files.hash(target);
        if (identities.has(current.identity))
          throw new CrosslinkError(
            "DUPLICATE_MEMBER",
            `The same physical file is registered more than once: ${member}`,
          );
        identities.add(current.identity);
        observed.set(member, current);
        entry.hash = current.hash;
      } catch (error) {
        result.errors.push(
          error instanceof CrosslinkError
            ? problem(error)
            : {
                code: "FILE_UNREADABLE",
                message: `Cannot read file: ${member}. Check existence and read permissions; restore the file, update its registered path if moved, or remove it from the group if deletion was intended.`,
              },
        );
      }
    }
    const confirmation = inspectConfirmation(
      group,
      ports.digest(canonicalDefinition(group)),
      result.files,
    );
    result.files = confirmation.files;
    if (group.roles) {
      const baseline = group.confirmation;
      result.sourceChanges =
        baseline && selection.complete
          ? [
              ...new Set([
                ...result.files
                  .filter(
                    (entry) =>
                      entry.role !== "target-only" &&
                      (entry.changed !== false || baseline.roles![entry.path] === "target-only"),
                  )
                  .map((entry) => entry.path),
                ...Object.keys(baseline.hashes).filter(
                  (path) =>
                    baseline.roles![path] !== "target-only" &&
                    (!selection.members.includes(path) ||
                      selection.roles.get(path) === "target-only"),
                ),
              ]),
            ].sort()
          : null;
    }
    if ((group.globs?.length || group.roles) && result.errors.length === 0) {
      // 後の対象を読んでいる間に、先に読んだ内容が変わった場合も拒否する。
      for (const entry of result.files) {
        try {
          const rechecked = ports.files.hash(resolve(dirname(file), entry.path));
          if (
            rechecked.hash !== entry.hash ||
            rechecked.identity !== observed.get(entry.path)?.identity
          )
            throw new CrosslinkError(
              "FILE_CHANGED",
              `File changed during inspection: ${entry.path}. Run check again before confirming.`,
            );
        } catch (error) {
          entry.hash = null;
          entry.changed = group.confirmation ? true : null;
          result.errors.push(
            error instanceof CrosslinkError
              ? problem(error)
              : {
                  code: "FILE_UNREADABLE",
                  message: `Cannot recheck file: ${entry.path}. Check existence and read permissions, then run check again.`,
                },
          );
        }
      }
      const after = selectMembers(file, group, ports);
      if (
        after.errors.length ||
        JSON.stringify([...after.roles]) !== JSON.stringify([...selection.roles])
      ) {
        if (group.globs?.length) result.membershipComplete = false;
        if (group.globs?.length) {
          result.added = null;
          result.removed = null;
        }
        if (group.roles) result.sourceChanges = null;
        result.errors.push(...after.errors, {
          code: "MEMBERS_CHANGED",
          message:
            "Selected files changed during inspection. Run check again and read all related files before confirming.",
        });
      }
    }
    if (result.errors.length === 0) {
      result.definitionVerified = false;
      if (ports.groups.readRaw(file) !== raw)
        throw new CrosslinkError("GROUP_CHANGED", "Management file changed during inspection.");
      delete result.definitionVerified;
      result.snapshot = ports.digest(inspectionSnapshot(file, raw, result.files));
      result.status = confirmation.status;
    }
  } catch (error) {
    result.errors.push(problem(error));
    if (result.definitionVerified === false && result.roles) result.sourceChanges = null;
    if (result.definitionVerified === false && result.globs) {
      result.added = null;
      result.removed = null;
    }
  }
  if (result.roles && result.errors.length) result.sourceChanges = null;
  if (result.roles && (result.definitionVerified === false || result.membershipComplete === false))
    result.reviewTargets = null;
  return result;
}
