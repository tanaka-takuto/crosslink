import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { run } from "../../bootstrap.js";

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
  expect(result.report.messages).toContain("No registered groups.");
});

it("writes a standalone HTML snapshot and notifies about zero groups", () => {
  const root = fixture();
  const result = run(["report", "--format", "html", "--output", "report.html"], root);
  expect(result.code).toBe(0);
  expect(result.report.operation).toBe("report");
  expect(result.report.messages).toContain("No registered groups.");
  expect(result.report.messages).toContain(`HTML report saved: ${join(root, "report.html")}`);
  expect(readFileSync(join(root, "report.html"), "utf8")).toContain("No registered groups.");
});

it("reuses check inspection and repeated --file selection for HTML without changing inputs", () => {
  const root = fixture();
  run(["create", "first", "a", "b", "--reason", "AとB"], root);
  run(["create", "second", "b", "c", "--reason", "BとC"], root);
  run(["create", "draft", "--reason", "編集途中"], root);
  const before = readFileSync(join(root, ".crosslink/first.json"), "utf8");
  const selected = ["--file", ".crosslink/first.json", "--file", ".crosslink/second.json"];
  const checked = run(["check", ...selected], root);
  const result = run(["report", "--format", "html", "--output", "report.html", ...selected], root);
  expect(result.code).toBe(1);
  expect(result.report.groups).toEqual(checked.report.groups);
  expect(result.report.errors).toEqual(checked.report.errors);
  expect(readFileSync(join(root, ".crosslink/first.json"), "utf8")).toBe(before);
  const html = readFileSync(join(root, "report.html"), "utf8");
  expect(html).toContain("AとB");
  expect(html).toContain("BとC");
  expect(html).not.toContain("編集途中");
  expect(html).toContain("Selected management files");
});

it("keeps drawable inspection errors in HTML and returns 2", () => {
  const root = fixture();
  run(["create", "draft", "--reason", "編集途中"], root);
  writeFileSync(join(root, ".crosslink/broken.json"), "{");
  const checked = run(["check"], root);
  const result = run(["report", "--format", "html", "--output", "errors.html"], root);
  expect(result.code).toBe(2);
  expect(result.report.groups).toEqual(checked.report.groups);
  const html = readFileSync(join(root, "errors.html"), "utf8");
  expect(html).toContain("Invalid management JSON");
  expect(html).toContain("At least two files are required");
});

it.each(
  [
    ["--output", "report.html"],
    ["--format", "html"],
    ["--format", "json", "--output", "report.html"],
    ["--format", "html", "--output", ""],
    ["--format", "html", "--output", "report.html", "extra"],
    ["--format", "html", "--output", "report.html", "--verbose"],
    ["--format", "html", "--format", "html", "--output", "report.html"],
    ["--format", "html", "--output", "one.html", "--output", "two.html"],
  ].map((args) => ({ args })),
)("rejects invalid report arguments $args", ({ args }) => {
  const result = run(["report", ...args], fixture());
  expect(result.code).toBe(2);
  expect(result.report.errors[0]?.code).toBe("INVALID_ARGUMENT");
});

it("honors --config and retains configuration failures in an HTML report", () => {
  const root = fixture();
  writeFileSync(join(root, "settings.json"), '{"directoryName":".links"}');
  run(
    ["create", "custom", "a", "b", "--reason", "custom reason", "--config", "settings.json"],
    root,
  );
  const result = run(
    ["report", "--format", "html", "--output", "custom.html", "--config", "settings.json"],
    root,
  );
  expect(result.code).toBe(1);
  expect(result.report.groups[0]?.name).toBe("custom");
  writeFileSync(join(root, "settings.json"), '{"directoryName":"bad/path"}');
  const invalid = run(
    ["report", "--format", "html", "--output", "invalid.html", "--config", "settings.json"],
    root,
  );
  expect(invalid.code).toBe(2);
  const html = readFileSync(join(root, "invalid.html"), "utf8");
  expect(html).toContain("INVALID_CONFIG");
  expect(html).toContain("Inspection incomplete");
  expect(html).not.toContain("No registered groups.");
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
    "No groups are related to this file.",
  );
});

// file-formats.md: 保存先に使っていないサンプルJSONは通常データとして扱う。
it("registers and adds an ordinary JSON sample without inferring its role from common fields", () => {
  const root = fixture();
  writeFileSync(
    join(root, "example.json"),
    JSON.stringify({ version: 1, name: "example", reason: "サンプル", files: ["a", "b"] }),
  );
  expect(
    run(["create", "sample", "a", "example.json", "--reason", "データと利用元"], root).code,
  ).toBe(0);
  expect(run(["create", "another", "a", "b", "--reason", "データと利用元"], root).code).toBe(0);
  expect(run(["add", ".crosslink/another.json", "example.json"], root).code).toBe(0);
  expect(run(["check", "--file", ".crosslink/sample.json"], root).code).toBe(1);
});

// groups.md: 実際に保存・確認した管理ファイルは名前によらず関連対象にできない。
it.each(
  ["outside.json", "outside.record", "outside", "outside.JSON"].flatMap((file) =>
    ["create", "add", "check"].map((operation) => ({ file, operation })),
  ),
)("rejects an actual record $file during $operation", ({ file, operation }) => {
  const root = fixture();
  expect(run(["create", "record", "a", "b", "--reason", "記録", "--file", file], root).code).toBe(
    0,
  );
  const review = join(root, "review.json");
  writeFileSync(review, JSON.stringify(run(["check", "--file", file], root).report));
  expect(run(["confirm", file, "--snapshot", review], root).code).toBe(0);
  expect(run(["create", "target", "a", "c", "--reason", "対象"], root).code).toBe(0);
  if (operation === "create") {
    expect(run(["create", "new", "c", file, "--reason", "対象"], root).code).toBe(2);
  } else if (operation === "add") {
    const target = join(root, ".crosslink/target.json");
    const before = readFileSync(target, "utf8");
    expect(run(["add", ".crosslink/target.json", file], root).code).toBe(2);
    expect(readFileSync(target, "utf8")).toBe(before);
  } else {
    const target = join(root, ".crosslink/target.json");
    const group = JSON.parse(readFileSync(target, "utf8"));
    group.files.push("../" + file);
    writeFileSync(target, JSON.stringify(group));
    expect(run(["check", "--file", ".crosslink/target.json"], root).code).toBe(2);
  }
});

it("reads legacy groups without mutation and explicitly migrates their identity", () => {
  const root = fixture();
  const file = join(root, "legacy.record");
  const original = JSON.stringify({
    version: 1,
    name: "legacy",
    reason: "旧形式",
    files: ["a", "b"],
  });
  writeFileSync(file, original);
  expect(run(["check", "--file", file], root).code).toBe(1);
  expect(readFileSync(file, "utf8")).toBe(original);
  expect(run(["migrate", file], root).code).toBe(0);
  expect(JSON.parse(readFileSync(file, "utf8")).kind).toBe("crosslink-group");
});

it("migration preserves the old confirmation rather than approving later content changes", () => {
  const root = fixture();
  const file = join(root, "legacy.record");
  run(["create", "legacy", "a", "b", "--reason", "旧形式", "--file", file], root);
  const review = join(root, "review.json");
  writeFileSync(review, JSON.stringify(run(["check", "--file", file], root).report));
  expect(run(["confirm", file, "--snapshot", review], root).code).toBe(0);
  const legacy = JSON.parse(readFileSync(file, "utf8"));
  delete legacy.kind;
  writeFileSync(file, JSON.stringify(legacy));
  expect(run(["check", "--file", file], root).code).toBe(0);
  writeFileSync(join(root, "a"), "new content");
  expect(run(["migrate", file], root).code).toBe(0);
  const migrated = JSON.parse(readFileSync(file, "utf8"));
  expect(migrated.kind).toBe("crosslink-group");
  expect(migrated.confirmation).toEqual(legacy.confirmation);
  expect(run(["check", "--file", file], root).code).toBe(1);
});

it("resolves absolute and relative targets from the management file regardless of invocation directory", () => {
  const root = fixture();
  const other = fixture();
  run(["create", "paths", join(root, "a"), "b", "--reason", "パスの確認"], root);
  const expected = run(["check"], root).report.groups;
  expect(
    run(["check", "--file", join(root, ".crosslink/paths.json")], other).report.groups,
  ).toEqual(expected);
});

it("keeps inspection deterministic and read-only and ignores unregistered changes", () => {
  const root = fixture();
  run(["create", "api", "a", "b", "--reason", "理由"], root);
  const review = join(root, "review.json");
  writeFileSync(review, JSON.stringify(run(["check"], root).report));
  run(["confirm", "--all", "--snapshot", review], root);
  const file = join(root, ".crosslink/api.json");
  const before = readFileSync(file, "utf8");
  const report = run(["check"], root).report;
  run(["related", "a"], root);
  writeFileSync(join(root, "c"), "unrelated change");
  expect(run(["check"], root).report).toEqual(report);
  expect(readFileSync(file, "utf8")).toBe(before);
  expect(readFileSync(join(root, "a"), "utf8")).toBe("a");
});

it("requires separate confirmations for every group containing a shared changed file", () => {
  const root = fixture();
  run(["create", "first", "a", "b", "--reason", "AとB"], root);
  run(["create", "second", "b", "c", "--reason", "BとC"], root);
  const review = join(root, "review.json");
  writeFileSync(review, JSON.stringify(run(["check"], root).report));
  run(["confirm", "--all", "--snapshot", review], root);
  writeFileSync(join(root, "b"), "shared change");
  expect(
    run(["check"], root).report.groups.filter((group) => group.status === "unconfirmed"),
  ).toHaveLength(2);
  writeFileSync(review, JSON.stringify(run(["check"], root).report));
  expect(run(["confirm", ".crosslink/first.json", "--snapshot", review], root).code).toBe(0);
  expect(run(["check", "--file", ".crosslink/second.json"], root).code).toBe(1);
});

it("recognizes declared management files after renaming and copying them", () => {
  const root = fixture();
  run(["create", "record", "a", "b", "--reason", "記録", "--file", "original.json"], root);
  const review = join(root, "review.json");
  writeFileSync(review, JSON.stringify(run(["check", "--file", "original.json"], root).report));
  expect(run(["confirm", "original.json", "--snapshot", review], root).code).toBe(0);
  renameSync(join(root, "original.json"), join(root, "renamed.data"));
  cpSync(join(root, "renamed.data"), join(root, "copied"));
  for (const file of ["renamed.data", "copied"]) {
    expect(run(["check", "--file", file], root).code).toBe(0);
    expect(run(["create", "other", "c", file, "--reason", "対象"], root).code).toBe(2);
  }
});
