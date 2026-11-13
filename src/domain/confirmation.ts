import type { Group } from "./group.js";

export interface MemberInspection {
  path: string;
  hash: string | null;
  changed: boolean | null;
}

export function inspectConfirmation(
  group: Group,
  definitionHash: string,
  members: { path: string; hash: string | null }[],
): { status: "confirmed" | "unconfirmed"; files: MemberInspection[] } {
  const files = members.map((member) => ({
    ...member,
    changed: group.confirmation ? group.confirmation.hashes[member.path] !== member.hash : null,
  }));
  const confirmed =
    group.files.length >= 2 &&
    members.length === group.files.length &&
    group.confirmation?.definition === definitionHash &&
    files.every((file) => file.hash !== null && file.changed === false);
  return { status: confirmed ? "confirmed" : "unconfirmed", files };
}
