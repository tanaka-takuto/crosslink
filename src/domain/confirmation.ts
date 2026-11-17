import type { Group, Role } from "./group.js";

export interface MemberInspection {
  path: string;
  hash: string | null;
  changed: boolean | null;
  role?: Role;
}

export function inspectConfirmation(
  group: Group,
  definitionHash: string,
  members: { path: string; hash: string | null; role?: Role }[],
): { status: "confirmed" | "unconfirmed"; files: MemberInspection[] } {
  const files = members.map((member) => ({
    ...member,
    changed: group.confirmation ? group.confirmation.hashes[member.path] !== member.hash : null,
  }));
  const sources = files.filter((file) => (file.role ?? "both") !== "target-only");
  const baselineSources = Object.keys(group.confirmation?.hashes ?? {}).filter(
    (path) => !group.roles || group.confirmation?.roles?.[path] !== "target-only",
  );
  const confirmed =
    members.length >= 2 &&
    (group.globs?.length
      ? true
      : group.files.length >= 2 && members.length === group.files.length) &&
    sources.length > 0 &&
    files.some((file) => (file.role ?? "both") !== "source-only") &&
    baselineSources.length === sources.length &&
    group.confirmation?.definition === definitionHash &&
    files.every((file) => file.hash !== null) &&
    sources.every((file) => baselineSources.includes(file.path) && file.changed === false);
  return { status: confirmed ? "confirmed" : "unconfirmed", files };
}
