import { dirname, resolve } from "node:path";
import { CrosslinkError } from "../domain/errors.js";
import { canonicalDefinition, validateGroup, type Group } from "../domain/group.js";
import { inspectGroup } from "./inspect-group.js";
import type { CrosslinkPorts, Settings } from "./ports.js";

function withoutRecord(group: Group): Group {
  return { name: group.name, reason: group.reason, files: [...group.files].sort() };
}

function validateMembers(
  file: string,
  group: Group,
  ports: CrosslinkPorts,
  settings: Settings,
): void {
  validateGroup(group);
  const identities = new Set<string>();
  for (const member of group.files) {
    const target = resolve(dirname(file), member);
    if (ports.files.isManagementFile(target, file, settings))
      throw new CrosslinkError(
        "MANAGEMENT_FILE",
        `Management files cannot be group members: ${member}`,
      );
    const current = ports.files.info(target);
    if (!current.isFile) throw new CrosslinkError("NOT_A_FILE", `Not a regular file: ${member}`);
    const identity = current.identity;
    if (identities.has(identity))
      throw new CrosslinkError(
        "DUPLICATE_MEMBER",
        `The same physical file is registered more than once: ${member}`,
      );
    identities.add(identity);
  }
}

export function createGroup(
  file: string,
  group: Group,
  ports: CrosslinkPorts,
  settings: Settings,
): void {
  file = resolve(file);
  const prepared = withoutRecord(group);
  validateMembers(file, prepared, ports, settings);
  ports.groups.withLocks([file], () => {
    if (ports.groups.exists(file))
      throw new CrosslinkError("ALREADY_EXISTS", `Management file already exists: ${file}`);
    ports.groups.write(file, prepared, true);
  });
}

export function updateGroup(
  file: string,
  update: (group: Group) => Group,
  ports: CrosslinkPorts,
  settings: Settings,
): void {
  file = resolve(file);
  ports.groups.withLocks([file], () => {
    const old = ports.groups.read(file).group;
    const next = withoutRecord(update(structuredClone(old)));
    validateMembers(file, next, ports, settings);
    if (
      ports.digest(canonicalDefinition(old)) === ports.digest(canonicalDefinition(next)) &&
      old.confirmation
    )
      next.confirmation = old.confirmation;
    ports.groups.write(file, next);
  });
}

export function confirmGroups(
  files: string[],
  expected: Map<string, string>,
  ports: CrosslinkPorts,
  settings: Settings,
): void {
  files = [...new Set(files.map((file) => resolve(file)))].sort();
  if (files.length === 0) throw new CrosslinkError("NO_SELECTION", "Select the groups to confirm.");
  ports.groups.withLocks(files, () => {
    const prepared = files.map((file) => {
      const { group, raw } = ports.groups.read(file);
      const current = inspectGroup(file, ports, settings);
      if (current.errors.length || !current.snapshot)
        throw new CrosslinkError(
          "INVALID_GROUP",
          `Cannot confirm an invalid group: ${file}. Run check --verbose to locate and fix the problems, then read all related files before confirming.`,
        );
      if (current.snapshot !== expected.get(file))
        throw new CrosslinkError(
          "STALE_SNAPSHOT",
          `State changed after inspection: ${file}. Run check --json again and read all related files before confirming with the new report.`,
        );
      if (
        current.snapshot !==
        ports.digest(
          JSON.stringify({
            file,
            raw,
            files: current.files.map((entry) => [entry.path, entry.hash]),
          }),
        )
      )
        throw new CrosslinkError(
          "STALE_SNAPSHOT",
          `Management data changed during inspection: ${file}. Run check --json again and read all related files before confirming with the new report.`,
        );
      group.confirmation = {
        definition: ports.digest(canonicalDefinition(group)),
        hashes: Object.fromEntries(current.files.map((entry) => [entry.path, entry.hash!])),
      };
      return { file, group };
    });
    const updated: string[] = [];
    try {
      for (const item of prepared) {
        ports.groups.write(item.file, item.group);
        updated.push(item.file);
      }
    } catch (error) {
      throw new CrosslinkError(
        "WRITE_FAILED",
        `Failed to save confirmation records. Already updated: ${JSON.stringify(updated)}. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

export function deleteGroup(file: string, ports: CrosslinkPorts): void {
  file = resolve(file);
  ports.groups.withLocks([file], () => {
    ports.groups.read(file);
    ports.groups.delete(file);
  });
}
