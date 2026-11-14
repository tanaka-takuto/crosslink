import { CrosslinkError } from "../../domain/errors.js";
import { validateGroup, type Group } from "../../domain/group.js";

export const groupKind = "crosslink-group";
export interface GroupRecord extends Group {
  kind?: typeof groupKind;
  version: 1;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fields(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new CrosslinkError("INVALID_DEFINITION", "Unsupported fields in the management file.");
}

export function parseGroup(text: string): GroupRecord {
  let value: unknown;
  try {
    value = JSON.parse(withoutBom(text));
  } catch {
    throw new CrosslinkError("INVALID_JSON", "Invalid management JSON.");
  }
  if (!object(value))
    throw new CrosslinkError("INVALID_DEFINITION", "Management file must be a JSON object.");
  fields(value, ["kind", "version", "name", "reason", "files", "confirmation"]);
  if (value.kind !== undefined && value.kind !== groupKind)
    throw new CrosslinkError("INVALID_DEFINITION", "Invalid management file kind.");
  if (value.version !== 1)
    throw new CrosslinkError("UNSUPPORTED_VERSION", "Only management file version 1 is supported.");
  validateGroup(value as unknown as Group);
  if (value.confirmation !== undefined) {
    const confirmation = value.confirmation;
    if (!object(confirmation))
      throw new CrosslinkError("INVALID_CONFIRMATION", "Invalid confirmation record.");
    fields(confirmation, ["definition", "hashes"]);
    const hex = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
    if (
      !hex(confirmation.definition) ||
      !object(confirmation.hashes) ||
      Object.values(confirmation.hashes).some((hash) => !hex(hash))
    )
      throw new CrosslinkError("INVALID_CONFIRMATION", "Invalid confirmation hashes.");
  }
  return value as unknown as GroupRecord;
}

function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
