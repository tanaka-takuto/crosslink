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
    if (group.roles) {
      lines.push("  Direction: sources → targets within this group; no cross-group propagation.");
      lines.push(
        "  Confirmed means: No unreviewed source impact. Target-only content may differ from the last confirmation.",
      );
      lines.push(
        `  Source changes: ${group.sourceChanges === null ? (group.errors.length ? "unavailable; inspection failed" : "no baseline; explicit review required") : group.sourceChanges?.length ? group.sourceChanges.join(", ") : "none"}`,
      );
      lines.push(
        `  Review targets: ${group.reviewTargets === null ? "unavailable; collected files may be incomplete" : group.reviewTargets?.join(", ") || "none"}`,
      );
      if (report.operation === "related")
        lines.push(
          "  Related lists current directional membership and removed history; target-only edits do not trigger source review.",
        );
    }
    for (const pattern of group.globs ?? []) lines.push(`  Glob: ${pattern}`);
    if (group.definitionVerified === false)
      lines.push(
        "  Management definition could not be verified; current member list may be incomplete.",
      );
    else if (group.membershipComplete === false)
      lines.push("  Membership comparison unavailable; current member list may be incomplete.");
    for (const file of group.files)
      lines.push(
        `  ${file.role ? { both: "Both", "source-only": "Source only", "target-only": "Target only" }[file.role] + " · " : ""}${group.added?.includes(file.path) ? "Added" : file.changed === null ? (group.globs ? "No baseline" : "New") : file.changed ? "Changed" : "Unchanged"}: ${file.path}`,
      );
    for (const file of group.removed ?? [])
      lines.push(`  Removed${file.role ? " (" + file.role + ")" : ""}: ${file.path}`);
    for (const error of group.errors) lines.push(`  ${error.code}: ${error.message}`);
  }
  if (compact && report.groups.some((group) => group.status !== "confirmed" || group.errors.length))
    lines.push("Use --verbose for all groups, files and reasons.");
  return lines.length ? lines.join("\n") + "\n" : "";
}
