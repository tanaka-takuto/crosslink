import type { Problem } from "../domain/errors.js";
import type { Inspection } from "./inspect-group.js";

export interface Report {
  version: 1;
  operation: string;
  result: "ok" | "unconfirmed" | "error";
  groups: Inspection[];
  errors: Problem[];
  messages: string[];
}

export interface InspectionResult {
  code: number;
  report: Report;
}

export function inspectionReport(operation: string, groups: Inspection[]): InspectionResult {
  const errors = groups.flatMap((group) =>
    group.errors.map((error) => ({ ...error, message: `${group.file}: ${error.message}` })),
  );
  const code = errors.length ? 2 : groups.some((group) => group.status === "unconfirmed") ? 1 : 0;
  return {
    code,
    report: {
      version: 1,
      operation,
      result: code === 2 ? "error" : code === 1 ? "unconfirmed" : "ok",
      groups,
      errors,
      messages: groups.length
        ? []
        : [
            operation === "related"
              ? "No groups are related to this file."
              : "No registered groups.",
          ],
    },
  };
}
