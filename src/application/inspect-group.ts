import { basename, dirname, relative, resolve, sep } from "node:path";
import { inspectConfirmation } from "../domain/confirmation.js";
import { CrosslinkError, problem, type Problem } from "../domain/errors.js";
import { canonicalDefinition, inspectionProblems, type Group } from "../domain/group.js";
import type { CrosslinkPorts, Settings } from "./ports.js";

export interface Inspection {
  file: string;
  name: string;
  reason: string;
  status: "confirmed" | "unconfirmed";
  files: { path: string; hash: string | null; changed: boolean | null }[];
  globs?: string[];
  added?: string[] | null;
  removed?: { path: string; hash: string }[] | null;
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
): { members: string[]; errors: Problem[]; complete: boolean } {
  const members = [...group.files];
  const selected = new Set(members.map((member) => resolve(dirname(file), member)));
  const errors: Problem[] = [];
  let complete = true;
  for (const pattern of [...new Set(group.globs ?? [])].sort()) {
    try {
      const matches = ports.files.expandGlob(pattern, dirname(file));
      if (!matches.length)
        errors.push({
          code: "GLOB_NO_MATCH",
          message: `Glob matches no files: ${pattern}. Add matching files or edit the selector, then run check and read all related files before confirming.`,
        });
      for (const match of matches) {
        const target = resolve(dirname(file), match);
        if (selected.has(target)) continue;
        selected.add(target);
        members.push(relative(dirname(file), target).split(sep).join("/"));
      }
    } catch (error) {
      complete = false;
      errors.push(problem(error));
    }
  }
  return { members: members.sort(), errors, complete };
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
              .map((path) => ({ path, hash: baseline[path]! }))
          : null;
    }
    const identities = new Set<string>();
    const observed = new Map<string, { hash: string; identity: string }>();
    for (const member of selection.members) {
      const entry: Inspection["files"][number] = {
        path: member,
        hash: null,
        changed: null,
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
    if (group.globs?.length && result.errors.length === 0) {
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
        JSON.stringify(after.members) !== JSON.stringify(selection.members)
      ) {
        result.membershipComplete = false;
        result.added = null;
        result.removed = null;
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
      result.snapshot = ports.digest(
        JSON.stringify({ file, raw, files: result.files.map((entry) => [entry.path, entry.hash]) }),
      );
      result.status = confirmation.status;
    }
  } catch (error) {
    result.errors.push(problem(error));
    if (result.definitionVerified === false && result.globs) {
      result.added = null;
      result.removed = null;
    }
  }
  return result;
}
