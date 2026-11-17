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

it("shows selectors, added and removed paths while keeping compact check concise", () => {
  const report: Report = {
    version: 1,
    operation: "check",
    result: "unconfirmed",
    groups: [
      {
        file: "/group.json",
        name: "ADR",
        reason: "review",
        status: "unconfirmed",
        files: [{ path: "new.md", hash: "hash", changed: true }],
        globs: ["**/*.md"],
        added: ["new.md"],
        removed: [{ path: "old.md", hash: "hash" }],
        membershipComplete: true,
        snapshot: "s",
        errors: [],
      },
    ],
    errors: [],
    messages: [],
  };
  expect(human(report, "/", true)).toContain("Glob: **/*.md");
  expect(human(report, "/", true)).toContain("Added: new.md");
  expect(human(report, "/", true)).toContain("Removed: old.md");
  expect(human(report, "/")).not.toContain("old.md");
});

it("separates directional source context, review targets and target content comparison", () => {
  const report: Report = {
    version: 1,
    operation: "check",
    result: "ok",
    errors: [],
    messages: [],
    groups: [
      {
        file: "/project/.crosslink/g.json",
        name: "方向",
        reason: "理由",
        status: "confirmed",
        errors: [],
        snapshot: "hash",
        roles: { files: { "../a": "source-only", "../b": "target-only" }, globs: {} },
        sourceChanges: [],
        reviewTargets: ["../b"],
        files: [
          { path: "../a", hash: "a", changed: false, role: "source-only" },
          { path: "../b", hash: "new", changed: true, role: "target-only" },
        ],
      },
    ],
  };
  const output = human(report, "/project", true);
  expect(output).toContain("Source only");
  expect(output).toContain("Target only");
  expect(output).toContain("Review targets: ../b");
  expect(output).toContain("Source changes: none");
  expect(output).toContain("No unreviewed source impact");
  expect(output).toContain("Target-only content may differ");
  expect(human(report, "/project")).not.toContain("../b");
});
