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

it("persists quoted glob selectors and tracks same-content additions, renames and removals", () => {
  const root = fixture();
  mkdirSync(join(root, "adr"));
  writeFileSync(join(root, "adr/one.md"), "same");
  writeFileSync(join(root, "adr/two.md"), "same");
  expect(
    run(["create", "adr", "a", "--glob", "adr/**/*.md", "--reason", "レビュー"], root).code,
  ).toBe(0);
  const file = join(root, ".crosslink/adr.json");
  const stored = JSON.parse(readFileSync(file, "utf8"));
  expect(stored.version).toBe(2);
  expect(stored.files).toEqual(["../a"]);
  expect(stored.globs).toEqual(["../adr/**/*.md"]);
  const review = join(root, "review.json");
  function confirm() {
    writeFileSync(review, JSON.stringify(run(["check"], root).report));
    expect(run(["confirm", file, "--snapshot", review], root).code).toBe(0);
  }
  confirm();
  const baseline = readFileSync(file, "utf8");
  writeFileSync(join(root, "adr/three.md"), "same");
  let result = run(["check"], root);
  expect(result.code).toBe(1);
  expect(result.report.groups[0]?.added).toEqual(["../adr/three.md"]);
  expect(run(["confirm", file, "--snapshot", review], root).code).toBe(2);
  expect(readFileSync(file, "utf8")).toBe(baseline);
  rmSync(join(root, "adr/three.md"));
  expect(run(["check"], root).code).toBe(0);
  renameSync(join(root, "adr/one.md"), join(root, "adr/renamed.md"));
  result = run(["related", "adr/one.md"], root);
  expect(result.report.groups[0]?.removed?.map((f) => f.path)).toEqual(["../adr/one.md"]);
  expect(result.report.groups[0]?.added).toEqual(["../adr/renamed.md"]);
  confirm();
  renameSync(join(root, "adr/renamed.md"), join(root, "outside.md"));
  result = run(["check"], root);
  expect(result.code).toBe(1);
  expect(result.report.groups[0]?.removed?.map((f) => f.path)).toEqual(["../adr/renamed.md"]);
  expect(result.report.groups[0]?.files).toHaveLength(2);
  confirm();
  writeFileSync(join(root, "adr/two.md"), "changed again");
  expect(run(["check"], root).code).toBe(1);
});

it("edits selectors explicitly without changing glob membership through literal remove", () => {
  const root = fixture();
  const file = join(root, ".crosslink/adr.json");
  expect(run(["create", "adr", "--reason", "draft", "--glob", "missing/*.md"], root).code).toBe(0);
  expect(run(["check"], root).code).toBe(2);
  expect(run(["add", file, "--glob", "a", "--glob", "b"], root).code).toBe(0);
  expect(run(["remove", file, "--glob", "missing/*.md"], root).code).toBe(0);
  expect(run(["check"], root).code).toBe(1);
  const before = readFileSync(file, "utf8");
  expect(run(["remove", file, "a"], root).code).toBe(2);
  expect(readFileSync(file, "utf8")).toBe(before);
  expect(run(["remove", file, "--glob", "not-registered*"], root).code).toBe(2);
  expect(run(["remove", file, "--glob", "a"], root).code).toBe(0);
  expect(run(["check"], root).report.errors.map((e) => e.code)).toContain("TOO_FEW_FILES");
});

it("rejects empty, unsupported and ambiguous glob syntax before converting from CWD", () => {
  const root = fixture();
  for (const pattern of ["", "   ", "!exclude*", "{a,b}", "*/../a"]) {
    const result = run(["create", "bad", "a", "b", "--glob", pattern, "--reason", "review"], root);
    expect(result.code).toBe(2);
    expect(result.report.errors[0]?.code).toBe("INVALID_DEFINITION");
  }
});

it("creates directional selectors, edits roles explicitly and preserves the ordinary v1/v2 format", () => {
  const root = fixture();
  const call = (...args: string[]) => run(args, root);
  expect(
    call("create", "direction", "a", "--role", "source-only", "--reason", "ADR impact").code,
  ).toBe(0);
  expect(call("add", ".crosslink/direction.json", "b", "--role", "target-only").code).toBe(0);
  const file = join(root, ".crosslink/direction.json");
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
    version: 3,
    roles: { files: { "../a": "source-only", "../b": "target-only" } },
  });
  let checked = call("check");
  writeFileSync(join(root, "snapshot.json"), JSON.stringify(checked.report));
  expect(call("confirm", "--all", "--snapshot", "snapshot.json").code).toBe(0);
  writeFileSync(join(root, "b"), "changed target");
  expect(call("check").code).toBe(0);
  expect(call("role", ".crosslink/direction.json", "a", "--role", "target-only").code).toBe(0);
  expect(call("role", ".crosslink/direction.json", "b", "--role", "source-only").code).toBe(0);
  expect(call("check").code).toBe(1);
  expect(call("role", ".crosslink/direction.json", "a", "b", "--role", "both").code).toBe(0);
  expect(call("check").report.groups[0]!.files.every((f) => f.role === undefined)).toBe(true);
  expect(call("remove", ".crosslink/direction.json", "b").code).toBe(0);
  expect(JSON.parse(readFileSync(file, "utf8"))).not.toHaveProperty("roles");
  expect(call("create", "legacy", "a", "b", "--reason", "legacy").code).toBe(0);
  expect(JSON.parse(readFileSync(join(root, ".crosslink/legacy.json"), "utf8"))).toMatchObject({
    version: 1,
  });
  expect(call("check", "--file", ".crosslink/legacy.json").report.groups[0]).not.toHaveProperty(
    "roles",
  );
  checked = call("create", "dynamic", "--glob", "*", "--role", "source-only", "--reason", "glob");
  expect(checked.code).toBe(0);
  expect(call("role", ".crosslink/dynamic.json", "--glob", "*", "--role", "target-only").code).toBe(
    0,
  );
  expect(call("remove", ".crosslink/dynamic.json", "--glob", "*").code).toBe(0);
});
it.each(["invalid", "SOURCE", ""])("rejects invalid role %s without writing", (role) => {
  const root = fixture();
  expect(run(["create", "x", "a", "b", "--reason", "r", "--role", role], root).code).toBe(2);
});
it("rejects role editing of unregistered selectors and duplicate role flags", () => {
  const root = fixture();
  run(["create", "x", "a", "b", "--reason", "r"], root);
  const file = join(root, ".crosslink/x.json"),
    before = readFileSync(file, "utf8");
  for (const args of [
    ["role", file, "c", "--role", "both"],
    ["role", file, "--glob", "*", "--role", "source-only"],
    ["role", file, "a"],
    ["role", file, "a", "--role", "both", "--role", "source-only"],
  ]) {
    expect(run(args, root).code).toBe(2);
    expect(readFileSync(file, "utf8")).toBe(before);
  }
});

it("explains confirmed target differences and directional reverse membership in generated HTML", () => {
  const root = fixture();
  run(["create", "ADR", "a", "--role", "source-only", "--reason", "ADR → code"], root);
  run(["add", ".crosslink/adr.json", "b", "--role", "target-only"], root);
  const file = run(["check"], root).report.groups[0]!.file;
  const checked = run(["check"], root);
  writeFileSync(join(root, "snapshot.json"), JSON.stringify(checked.report));
  expect(run(["confirm", file, "--snapshot", "snapshot.json"], root).code).toBe(0);
  writeFileSync(join(root, "b"), "changed target");
  expect(run(["report", "--format", "html", "--output", "direction.html"], root).code).toBe(0);
  const html = readFileSync(join(root, "direction.html"), "utf8");
  for (const text of [
    "Source only",
    "Target only",
    "Source changes",
    "Review targets",
    "No unreviewed source impact",
    "Target-only content may differ",
    "Changes here trigger target review",
    "Receives review when sources change",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain(
    "Group confirmation also depends on the group definition and the complete path set.",
  );
  expect(html).not.toContain(
    "Confirmed means the inspected content matches a recorded confirmation",
  );
});

it("keeps old both assignments and existing glob additions byte-identical without implicit role edits", () => {
  const root = fixture();
  const call = (...args: string[]) => run(args, root);
  call("create", "legacy", "a", "--glob", "b", "--reason", "legacy");
  const file = join(root, ".crosslink/legacy.json"),
    snapshot = join(root, "snapshot.json");
  writeFileSync(snapshot, JSON.stringify(call("check").report));
  expect(call("confirm", "--all", "--snapshot", snapshot).code).toBe(0);
  const before = readFileSync(file, "utf8");
  for (const args of [
    ["role", file, "a", "--glob", "b", "--role", "both"],
    ["add", file, "--glob", "b"],
    ["add", file, "--glob", "b", "--role", "both"],
  ]) {
    expect(call(...args).code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(before);
  }
  expect(call("create", "allboth", "a", "b", "--role", "both", "--reason", "both").code).toBe(0);
  expect(JSON.parse(readFileSync(join(root, ".crosslink/allboth.json"), "utf8")).version).toBe(1);
  expect(call("role", file, "--glob", "b", "--role", "source-only").code).toBe(0);
  const directional = readFileSync(file, "utf8");
  expect(call("add", file, "--glob", "b").code).toBe(0);
  expect(readFileSync(file, "utf8")).toBe(directional);
  expect(call("add", file, "--glob", "b", "--role", "source-only").code).toBe(0);
  expect(readFileSync(file, "utf8")).toBe(directional);
  const refused = call("add", file, "--glob", "b", "--glob", "c", "--role", "target-only");
  expect(refused.code).toBe(2);
  expect(refused.report.errors[0]!.message).toContain("role");
  expect(readFileSync(file, "utf8")).toBe(directional);
  expect(call("add", file, "--glob", "b", "--glob", "c", "--role", "source-only").code).toBe(0);
  expect(JSON.parse(readFileSync(file, "utf8")).roles.globs).toEqual({
    "../b": "source-only",
    "../c": "source-only",
  });
  expect(call("role", file, "--glob", "b", "--glob", "c", "--role", "both").code).toBe(0);
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: 2 });
  expect(JSON.parse(readFileSync(file, "utf8"))).not.toHaveProperty("confirmation");
});
it("preserves external empty-role v3 on no-op and explicit confirmation", () => {
  const root = fixture();
  mkdirSync(join(root, ".crosslink"));
  const file = join(root, ".crosslink/empty.json");
  const raw = JSON.stringify({
    version: 3,
    name: "empty",
    reason: "external",
    files: ["../a", "../b"],
    roles: { files: {}, globs: {} },
  });
  writeFileSync(file, raw);
  expect(run(["role", file, "a", "--role", "both"], root).code).toBe(0);
  expect(readFileSync(file, "utf8")).toBe(raw);
  const snapshot = join(root, "snapshot.json");
  writeFileSync(snapshot, JSON.stringify(run(["check"], root).report));
  expect(run(["confirm", "--all", "--snapshot", snapshot], root).code).toBe(0);
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
    version: 3,
    roles: { files: {}, globs: {} },
    confirmation: { roles: { "../a": "both", "../b": "both" } },
  });
});

it("keeps directional groups independent and target reverse lookup distinct from propagation", () => {
  const root = fixture(),
    call = (...args: string[]) => run(args, root);
  for (const [name, source, target] of [
    ["first", "a", "b"],
    ["second", "b", "c"],
  ]) {
    expect(call("create", name!, source!, "--role", "source-only", "--reason", "impact").code).toBe(
      0,
    );
    expect(call("add", `.crosslink/${name}.json`, target!, "--role", "target-only").code).toBe(0);
  }
  const snapshot = join(root, "snapshot.json");
  writeFileSync(snapshot, JSON.stringify(call("check").report));
  expect(call("confirm", "--all", "--snapshot", snapshot).code).toBe(0);
  writeFileSync(join(root, "a"), "changed a");
  expect(call("check").report.groups.map((g) => g.status)).toEqual(["unconfirmed", "confirmed"]);
  expect(call("related", "a").report.groups.map((g) => g.name)).toEqual(["first"]);
  writeFileSync(join(root, "a"), "a");
  writeFileSync(join(root, "b"), "changed b");
  const related = call("related", "b").report.groups;
  expect(related.map((g) => g.status)).toEqual(["confirmed", "unconfirmed"]);
  expect(related.map((g) => g.sourceChanges)).toEqual([[], ["../b"]]);
  expect(related.map((g) => g.reviewTargets)).toEqual([["../b"], ["../c"]]);
  expect(call("role", ".crosslink/first.json", "a", "--role", "both").code).toBe(0);
  expect(call("role", ".crosslink/first.json", "a", "--role", "source-only").code).toBe(0);
  expect(call("check", "--file", ".crosslink/first.json").report.groups[0]!.status).toBe(
    "unconfirmed",
  );
  expect(JSON.parse(readFileSync(join(root, ".crosslink/first.json"), "utf8"))).not.toHaveProperty(
    "confirmation",
  );
});
