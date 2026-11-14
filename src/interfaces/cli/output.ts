import { relative } from "node:path";
import type { Report } from "./commands.js";

export function human(report: Report, cwd: string, verbose = false): string {
  const lines = [...report.messages];
  const compact = report.operation === "check" && !verbose;
  if (report.operation === "check" && report.groups.length) {
    const invalid = report.groups.filter((group) => group.errors.length > 0).length;
    const confirmed = report.groups.filter(
      (group) => group.errors.length === 0 && group.status === "confirmed",
    ).length;
    const unconfirmed = report.groups.length - invalid - confirmed;
    lines.push(`Groups: ${confirmed} confirmed, ${unconfirmed} unconfirmed, ${invalid} invalid.`);
  }
  for (const group of report.groups) {
    if (compact && group.status === "confirmed" && group.errors.length === 0) continue;
    const status = group.errors.length
      ? "Invalid"
      : group.status === "confirmed"
        ? "Confirmed"
        : "Unconfirmed";
    lines.push(`${status}: ${group.name} (${relative(cwd, group.file)})`);
    if (compact) continue;
    lines.push(`  Reason: ${group.reason}`);
    for (const file of group.files)
      lines.push(
        `  ${file.changed === null ? "New" : file.changed ? "Changed" : "Unchanged"}: ${file.path}`,
      );
    for (const error of group.errors) lines.push(`  ${error.code}: ${error.message}`);
  }
  if (compact && report.groups.some((group) => group.status !== "confirmed" || group.errors.length))
    lines.push("Use --verbose for all groups, files and reasons.");
  return lines.length ? lines.join("\n") + "\n" : "";
}
