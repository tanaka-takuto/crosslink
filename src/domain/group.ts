import { CrosslinkError, type Problem } from "./errors.js";

export interface Group {
  name: string;
  reason: string;
  files: string[];
  confirmation?: { definition: string; hashes: Record<string, string> };
}

export function validateGroup(group: Group): void {
  if (
    typeof group.name !== "string" ||
    !group.name.trim() ||
    typeof group.reason !== "string" ||
    !group.reason.trim()
  )
    throw new CrosslinkError("INVALID_DEFINITION", "A name and a reason for review are required.");
  if (
    !Array.isArray(group.files) ||
    group.files.some((file) => typeof file !== "string" || !file.trim() || file.includes("\0"))
  )
    throw new CrosslinkError("INVALID_DEFINITION", "files must be an array of file paths.");
  if (new Set(group.files).size !== group.files.length)
    throw new CrosslinkError("DUPLICATE_MEMBER", "The same path is registered more than once.");
}

export function inspectionProblems(group: Group): Problem[] {
  return group.files.length < 2
    ? [
        {
          code: "TOO_FEW_FILES",
          message: `At least two files are required for inspection (found ${group.files.length}). Add member files to this group, then run check and read all related files before confirming.`,
        },
      ]
    : [];
}

export function canonicalDefinition(group: Group): string {
  return JSON.stringify({ name: group.name, reason: group.reason, files: [...group.files].sort() });
}
