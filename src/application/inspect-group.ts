import { basename, dirname, resolve } from "node:path";
import { inspectConfirmation } from "../domain/confirmation.js";
import { CrosslinkError, problem, type Problem } from "../domain/errors.js";
import { canonicalDefinition, inspectionProblems } from "../domain/group.js";
import type { CrosslinkPorts, Settings } from "./ports.js";

export interface Inspection {
  file: string;
  name: string;
  reason: string;
  status: "confirmed" | "unconfirmed";
  files: { path: string; hash: string | null; changed: boolean | null }[];
  snapshot: string | null;
  errors: Problem[];
}

export function inspectGroup(file: string, ports: CrosslinkPorts, settings: Settings): Inspection {
  file = resolve(file);
  const result: Inspection = {
    file,
    name: basename(file),
    reason: "",
    status: "unconfirmed",
    files: [],
    snapshot: null,
    errors: [],
  };
  try {
    const { group, raw } = ports.groups.read(file);
    result.name = group.name;
    result.reason = group.reason;
    result.errors.push(...inspectionProblems(group));
    const identities = new Set<string>();
    for (const member of [...group.files].sort()) {
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
        entry.hash = current.hash;
      } catch (error) {
        result.errors.push(
          error instanceof CrosslinkError
            ? problem(error)
            : { code: "FILE_UNREADABLE", message: `Cannot read file: ${member}` },
        );
      }
    }
    const confirmation = inspectConfirmation(
      group,
      ports.digest(canonicalDefinition(group)),
      result.files,
    );
    result.files = confirmation.files;
    if (result.errors.length === 0) {
      if (ports.groups.readRaw(file) !== raw)
        throw new CrosslinkError("GROUP_CHANGED", "Management file changed during inspection.");
      result.snapshot = ports.digest(
        JSON.stringify({ file, raw, files: result.files.map((entry) => [entry.path, entry.hash]) }),
      );
      result.status = confirmation.status;
    }
  } catch (error) {
    result.errors.push(problem(error));
  }
  return result;
}
