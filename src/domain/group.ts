import { validateGlob } from "./glob.js";
import { CrosslinkError, type Problem } from "./errors.js";

export type Role = "both" | "source-only" | "target-only";
export interface SelectorRoles {
  files: Record<string, Exclude<Role, "both">>;
  globs: Record<string, Exclude<Role, "both">>;
}

export interface Group {
  name: string;
  reason: string;
  files: string[];
  globs?: string[];
  roles?: SelectorRoles;
  confirmation?: {
    definition: string;
    hashes: Record<string, string>;
    roles?: Record<string, Role>;
  };
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
  if (group.globs !== undefined) {
    if (!Array.isArray(group.globs))
      throw new CrosslinkError("INVALID_DEFINITION", "globs must be an array of patterns.");
    group.globs.forEach(validateGlob);
  }
  if (group.roles !== undefined) {
    const roles = group.roles;
    const object = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value);
    if (
      !object(roles) ||
      Object.keys(roles).some((key) => !["files", "globs"].includes(key)) ||
      !object(roles.files) ||
      !object(roles.globs)
    )
      throw new CrosslinkError("INVALID_DEFINITION", "roles must contain files and globs maps.");
    for (const kind of ["files", "globs"] as const)
      for (const [selector, role] of Object.entries(roles[kind]))
        if (
          !(group[kind] ?? []).includes(selector) ||
          !["source-only", "target-only"].includes(role)
        )
          throw new CrosslinkError(
            "INVALID_DEFINITION",
            "Roles must reference registered selectors and use source-only or target-only; omit both overrides.",
          );
  }
  if (new Set(group.files).size !== group.files.length)
    throw new CrosslinkError("DUPLICATE_MEMBER", "The same path is registered more than once.");
}

export function inspectionProblems(group: Group, count = group.files.length): Problem[] {
  return count < 2
    ? [
        {
          code: "TOO_FEW_FILES",
          message: `At least two files are required for inspection (found ${count}). Add member files to this group, then run check and read all related files before confirming.`,
        },
      ]
    : [];
}

export function canonicalDefinition(group: Group): string {
  return JSON.stringify({
    name: group.name,
    reason: group.reason,
    files: [...group.files].sort(),
    ...(group.globs?.length ? { globs: [...new Set(group.globs)].sort() } : {}),
    ...(group.roles
      ? {
          roles: Object.fromEntries(
            (["files", "globs"] as const).map((kind) => [
              kind,
              Object.fromEntries(
                Object.entries(group.roles![kind]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
              ),
            ]),
          ),
        }
      : {}),
  });
}
