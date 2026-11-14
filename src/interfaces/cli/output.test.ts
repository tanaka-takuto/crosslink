import { resolve } from "node:path";
import { expect, it } from "vitest";
import type { Report } from "./commands.js";
import { human } from "./output.js";

it("counts inspection errors as invalid even when a confirmation status is present", () => {
  const cwd = resolve("project");
  const report: Report = {
    version: 1,
    operation: "check",
    result: "error",
    messages: [],
    errors: [],
    groups: [
      {
        file: resolve(cwd, "group.json"),
        name: "group",
        reason: "reason",
        status: "confirmed",
        files: [],
        snapshot: null,
        errors: [{ code: "FILE_UNREADABLE", message: "Cannot read file: a" }],
      },
    ],
  };
  expect(human(report, cwd)).toContain("Groups: 0 confirmed, 0 unconfirmed, 1 invalid.");
  expect(human(report, cwd)).toContain("Invalid: group (group.json)");
  expect(human(report, cwd, true)).toContain("FILE_UNREADABLE: Cannot read file: a");
});

it("keeps related output detailed without requiring verbose", () => {
  const cwd = resolve("project");
  const report: Report = {
    version: 1,
    operation: "related",
    result: "ok",
    messages: [],
    errors: [],
    groups: [
      {
        file: resolve(cwd, "group.json"),
        name: "名前",
        reason: "利用者の理由",
        status: "confirmed",
        files: [{ path: "ファイル", hash: "a".repeat(64), changed: false }],
        snapshot: "b".repeat(64),
        errors: [],
      },
    ],
  };
  expect(human(report, cwd)).toBe(
    "Confirmed: 名前 (group.json)\n  Reason: 利用者の理由\n  Unchanged: ファイル\n",
  );
});
