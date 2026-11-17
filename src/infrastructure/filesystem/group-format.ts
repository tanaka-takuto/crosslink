import { CrosslinkError } from "../../domain/errors.js";
import { validateGroup, type Group } from "../../domain/group.js";

export const groupKind = "crosslink-group";
export interface GroupRecord extends Group {
  kind?: typeof groupKind;
  version: 1 | 2 | 3;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(code: string, message: string): never {
  throw new CrosslinkError(
    code,
    `${message} Repair the management JSON or restore a valid copy, then run check again.`,
  );
}

function fields(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    invalid("INVALID_DEFINITION", "Unsupported fields in the management file.");
}

export function parseGroup(text: string): GroupRecord {
  let value: unknown;
  try {
    value = JSON.parse(withoutBom(text));
  } catch {
    invalid("INVALID_JSON", "Invalid management JSON.");
  }
  if (!object(value)) invalid("INVALID_DEFINITION", "Management file must be a JSON object.");
  fields(value, ["kind", "version", "name", "reason", "files", "globs", "roles", "confirmation"]);
  if (value.kind !== undefined && value.kind !== groupKind)
    invalid("INVALID_DEFINITION", "Invalid management file kind.");
  if (value.version !== 1 && value.version !== 2 && value.version !== 3)
    throw new CrosslinkError(
      "UNSUPPORTED_VERSION",
      "Only management file versions 1, 2 and 3 are supported. Use a compatible crosslink version or restore a supported copy, then run check again.",
    );
  if (value.version === 1 && value.globs !== undefined)
    invalid("INVALID_DEFINITION", "Glob definitions require management file version 2.");
  if (value.version !== 3 && value.roles !== undefined)
    invalid("INVALID_DEFINITION", "Directional roles require management file version 3.");
  if (value.version === 3 && value.roles === undefined)
    invalid("INVALID_DEFINITION", "Version 3 requires selector roles.");
  try {
    validateGroup(value as unknown as Group);
  } catch (error) {
    if (error instanceof CrosslinkError) invalid(error.code, error.message);
    throw error;
  }
  if (value.confirmation !== undefined) {
    const confirmation = value.confirmation;
    if (!object(confirmation)) invalid("INVALID_CONFIRMATION", "Invalid confirmation record.");
    fields(
      confirmation,
      value.version === 3 ? ["definition", "hashes", "roles"] : ["definition", "hashes"],
    );
    const hex = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
    if (
      !hex(confirmation.definition) ||
      !object(confirmation.hashes) ||
      Object.values(confirmation.hashes).some((hash) => !hex(hash))
    )
      invalid("INVALID_CONFIRMATION", "Invalid confirmation hashes.");
    if (
      value.version === 3 &&
      (!object(confirmation.roles) ||
        Object.keys(confirmation.hashes as object).length < 2 ||
        Object.keys(confirmation.hashes as object).some(
          (path) => !path.trim() || path.includes("\0"),
        ) ||
        !Object.values(confirmation.roles).some((role) => role !== "target-only") ||
        !Object.values(confirmation.roles).some((role) => role !== "source-only") ||
        Object.keys(confirmation.roles).length !==
          Object.keys(confirmation.hashes as object).length ||
        Object.keys(confirmation.hashes as object).some(
          (path) => !Object.hasOwn(confirmation.roles as object, path),
        ) ||
        Object.values(confirmation.roles).some(
          (role) => !["both", "source-only", "target-only"].includes(role as string),
        ))
    )
      invalid("INVALID_CONFIRMATION", "Invalid effective-role baseline.");
  }
  return value as unknown as GroupRecord;
}

function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
