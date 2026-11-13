import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { run } from "./commands.js";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "crosslink-cli-"));
  roots.push(root);
  writeFileSync(join(root, "a"), "a");
  writeFileSync(join(root, "b"), "b");
  writeFileSync(join(root, "c"), "c");
  return root;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it("notifies that there are no registered groups, without initialization", () => {
  const result = run(["check", "--json"], fixture());
  expect(result.code).toBe(0);
  expect(result.report.messages).toContain("登録されたグループはありません");
});
it("creates, checks, explicitly confirms and detects later changes", () => {
  const root = fixture();
  expect(run(["create", "api", "a", "b", "--reason", "API整合性"], root).code).toBe(0);
  expect(run(["check", "--json"], root).code).toBe(1);
  const snapshot = join(root, "review.json");
  writeFileSync(snapshot, JSON.stringify(run(["check", "--json"], root).report));
  expect(run(["confirm", ".crosslink/api.json", "--snapshot", snapshot], root).code).toBe(0);
  expect(run(["check"], root).code).toBe(0);
  writeFileSync(join(root, "a"), "updated");
  expect(run(["check"], root).code).toBe(1);
  expect(run(["confirm", ".crosslink/api.json", "--snapshot", snapshot], root).code).toBe(2);
});
it("saves 0/1 member drafts successfully while check fails", () => {
  const root = fixture();
  expect(run(["create", "draft", "--reason", "作業途中"], root).code).toBe(0);
  expect(run(["check"], root).code).toBe(2);
  expect(run(["add", ".crosslink/draft.json", "a"], root).code).toBe(0);
  expect(run(["check"], root).code).toBe(2);
  expect(run(["add", ".crosslink/draft.json", "b"], root).code).toBe(0);
  expect(run(["check"], root).code).toBe(1);
});
it("does not propagate across groups and keeps confirmation independent", () => {
  const root = fixture();
  run(["create", "first", "a", "b", "--reason", "AとB"], root);
  run(["create", "second", "b", "c", "--reason", "BとC"], root);
  const snapshot = join(root, "review.json");
  writeFileSync(snapshot, JSON.stringify(run(["check"], root).report));
  expect(run(["confirm", "--all", "--snapshot", snapshot], root).code).toBe(0);
  writeFileSync(join(root, "a"), "new");
  const related = run(["related", "a", "--json"], root).report;
  expect(related.groups).toHaveLength(1);
  expect(run(["check", "--file", ".crosslink/second.json"], root).code).toBe(0);
});
it("uses configured directory and file names", () => {
  const root = fixture();
  writeFileSync(
    join(root, "crosslink.config.json"),
    JSON.stringify({ directoryName: ".links", fileNameTemplate: "group-{name}.json" }),
  );
  expect(run(["create", "api", "a", "b", "--reason", "理由"], root).code).toBe(0);
  expect(JSON.parse(readFileSync(join(root, ".links/group-api.json"), "utf8")).name).toBe("api");
  expect(run(["check"], root).code).toBe(1);
});
it.each(
  [
    ["confirm"],
    ["wat"],
    ["check", "--all"],
    ["create", "bad"],
    ["check", "--file", "missing.json"],
  ].map((args) => ({ args })),
)("rejects invalid invocation $args", ({ args }) => {
  expect(run(args, fixture()).code).toBe(2);
});
it("does not treat malformed discovered JSON as no groups", () => {
  const root = fixture();
  mkdirSync(join(root, ".crosslink"));
  writeFileSync(join(root, ".crosslink/bad.json"), "{");
  expect(run(["check", "--json"], root).code).toBe(2);
});

it("does not silently omit invalid groups from --all confirmation", () => {
  const root = fixture();
  run(["create", "valid", "a", "b", "--reason", "理由"], root);
  run(["create", "draft", "--reason", "編集途中"], root);
  const file = join(root, ".crosslink/valid.json");
  const before = readFileSync(file, "utf8");
  const review = join(root, "review.json");
  writeFileSync(review, JSON.stringify(run(["check"], root).report));
  expect(run(["confirm", "--all", "--snapshot", review], root).code).toBe(2);
  expect(readFileSync(file, "utf8")).toBe(before);
});

it("distinguishes no related group from no registered groups", () => {
  const root = fixture();
  run(["create", "api", "a", "b", "--reason", "理由"], root);
  expect(run(["related", "c"], root).report.messages).toContain(
    "このファイルに関連するグループはありません",
  );
});
