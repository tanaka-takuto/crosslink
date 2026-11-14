import { expect, it } from "vitest";
import { inspectionReport } from "./inspection-report.js";
import type { Inspection } from "./inspect-group.js";

it("gives inspection errors priority over unconfirmed groups without discarding their evidence", () => {
  const groups: Inspection[] = [
    {
      file: "/unconfirmed.json",
      name: "first",
      reason: "reason",
      status: "unconfirmed",
      files: [],
      snapshot: "snapshot",
      errors: [],
    },
    {
      file: "/invalid.json",
      name: "second",
      reason: "draft",
      status: "unconfirmed",
      files: [],
      snapshot: null,
      errors: [{ code: "TOO_FEW_FILES", message: "At least two files are required." }],
    },
  ];
  for (const operation of ["check", "report"]) {
    const result = inspectionReport(operation, groups);
    expect(result.code).toBe(2);
    expect(result.report.groups).toEqual(groups);
    expect(result.report.errors).toEqual([
      { code: "TOO_FEW_FILES", message: "/invalid.json: At least two files are required." },
    ]);
  }
});
