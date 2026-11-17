import { spawnSync } from "node:child_process";
import {
  cpSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "crosslink-runtime-"));
  roots.push(root);
  // node_modulesやpnpmのない場所へビルド結果だけをコピーして実行する。
  cpSync(resolve(dirname(fileURLToPath(import.meta.url)), "../dist"), join(root, "dist"), {
    recursive: true,
  });
  cpSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"),
    join(root, "package.json"),
  );
  writeFileSync(join(root, "a"), "a");
  writeFileSync(join(root, "b"), Buffer.from([0, 255]));
  const call = (...args: string[]) =>
    spawnSync(process.execPath, [join(root, "dist/cli.js"), ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: "" },
    });
  return { root, call };
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it("runs the full CLI with Node alone and keeps JSON stdout clean", () => {
  const { root, call } = fixture();
  expect(call("create", "api", "a", "b", "--reason", "整合性").status).toBe(0);
  const checked = call("check", "--json");
  expect(checked.status).toBe(1);
  expect(checked.stderr).toBe("");
  const result = JSON.parse(checked.stdout);
  expect(result.groups).toHaveLength(1);
  const review = join(root, "review.json");
  writeFileSync(review, checked.stdout);
  expect(call("confirm", ".crosslink/api.json", "--snapshot", review).status).toBe(0);
  expect(call("check").status).toBe(0);
  const before = readFileSync(join(root, ".crosslink/api.json"), "utf8");
  call("check");
  expect(readFileSync(join(root, ".crosslink/api.json"), "utf8")).toBe(before);
  writeFileSync(join(root, "b"), "changed");
  expect(call("check").status).toBe(1);
  expect(call("confirm", ".crosslink/api.json", "--snapshot", review).status).toBe(2);
});

it("serializes invocation errors as JSON without a stack trace", () => {
  const { call } = fixture();
  const result = call("check", "--unknown", "--json");
  expect(result.status).toBe(2);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).result).toBe("error");
});

it.each([
  { report: "{", code: "IO_ERROR" },
  { report: '{"version":2,"groups":[]}', code: "INVALID_SNAPSHOT" },
  { report: '{"version":1}', code: "INVALID_SNAPSHOT" },
  { report: "relative path", code: "INVALID_SNAPSHOT" },
  { report: "duplicate target", code: "INVALID_SNAPSHOT" },
  { report: "invalid hash", code: "INVALID_SNAPSHOT" },
])("guides invalid snapshot reports without changing files: $report", ({ report, code }) => {
  const { root, call } = fixture();
  call("create", "api", "a", "b", "--reason", "理由");
  const groupFile = join(root, ".crosslink/api.json");
  const review = join(root, "review ' $().json");
  const checked = JSON.parse(call("check", "--json").stdout);
  if (report === "relative path") checked.groups[0].file = ".crosslink/api.json";
  if (report === "duplicate target") checked.groups.push(checked.groups[0]);
  if (report === "invalid hash") checked.groups[0].snapshot = "invalid";
  const raw = report.startsWith("{") ? report : JSON.stringify(checked);
  writeFileSync(review, raw);
  const before = readFileSync(groupFile, "utf8");
  const args = ["confirm", groupFile, "--snapshot", review];
  const result = call(...args, "--json");
  expect(result.status).toBe(2);
  expect(result.stderr).toBe("");
  const error = JSON.parse(result.stdout).errors[0];
  expect(error.code).toBe(code);
  expect(error.message).toContain(review);
  expect(error.message).toContain("Run check --json again and read all related files");
  expect(call(...args).stderr).toContain(error.message);
  expect(readFileSync(groupFile, "utf8")).toBe(before);
  expect(readFileSync(review, "utf8")).toBe(raw);
  expect(readFileSync(join(root, "a"), "utf8")).toBe("a");
});

it("rejects stale snapshots with reinspection and review guidance and preserves existing records", () => {
  const { root, call } = fixture();
  call("create", "api", "a", "b", "--reason", "理由");
  const review = join(root, "review.json");
  writeFileSync(review, call("check", "--json").stdout);
  expect(call("confirm", "--all", "--snapshot", review).status).toBe(0);
  const groupFile = join(root, ".crosslink/api.json");
  const before = readFileSync(groupFile, "utf8");
  writeFileSync(review, call("check", "--json").stdout);
  writeFileSync(join(root, "a"), "changed");
  const reportBefore = readFileSync(review, "utf8");
  const result = call("confirm", "--all", "--snapshot", review, "--json");
  expect(result.status).toBe(2);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).errors).toEqual([
    {
      code: "STALE_SNAPSHOT",
      message: expect.stringContaining("Run check --json again and read all related files"),
    },
  ]);
  expect(JSON.parse(result.stdout).errors[0].message).toContain(groupFile);
  expect(readFileSync(groupFile, "utf8")).toBe(before);
  expect(readFileSync(review, "utf8")).toBe(reportBefore);
  expect(readFileSync(join(root, "a"), "utf8")).toBe("changed");
  writeFileSync(review, call("check", "--json").stdout);
  expect(call("confirm", "--all", "--snapshot", review).status).toBe(0);
});

it.each([
  { scenario: "missing", code: "FILE_UNREADABLE", guidance: "if deletion was intended" },
  { scenario: "directory", code: "NOT_A_FILE", guidance: "regular file" },
  { scenario: "zero", code: "TOO_FEW_FILES", guidance: "Add member files" },
  { scenario: "one", code: "TOO_FEW_FILES", guidance: "Add member files" },
  { scenario: "broken JSON", code: "INVALID_JSON", guidance: "restore a valid copy" },
])(
  "keeps check compact and exposes safe guidance for $scenario",
  ({ scenario, code, guidance }) => {
    const { root, call } = fixture();
    call("create", "要確認", "a", "b", "--reason", "理由を保持する");
    const groupFile = join(root, ".crosslink/要確認.json");
    const review = join(root, "review.json");
    writeFileSync(review, call("check", "--json").stdout);
    expect(call("confirm", "--all", "--snapshot", review).status).toBe(0);
    if (scenario === "missing") unlinkSync(join(root, "b"));
    if (scenario === "directory") {
      unlinkSync(join(root, "b"));
      mkdirSync(join(root, "b"));
    }
    if (scenario === "zero") call("remove", groupFile, "a", "b");
    if (scenario === "one") call("remove", groupFile, "b");
    if (scenario === "broken JSON") writeFileSync(groupFile, "{");
    const before = readFileSync(groupFile, "utf8");
    const compact = call("check");
    expect(compact.status).toBe(2);
    expect(compact.stdout).toBe(
      "Groups: 0 confirmed, 0 unconfirmed, 1 invalid.\n" +
        `Invalid: ${scenario === "broken JSON" ? "要確認.json" : "要確認"} (${join(".crosslink", "要確認.json")})\n` +
        "Use --verbose for all groups, files and reasons.\n",
    );
    const result = call("check", "--json");
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout);
    expect(Object.keys(report).sort()).toEqual([
      "errors",
      "groups",
      "messages",
      "operation",
      "result",
      "version",
    ]);
    expect(report.version).toBe(1);
    expect(report.result).toBe("error");
    expect(report.groups[0].snapshot).toBeNull();
    expect(report.errors[0]).toEqual({ code, message: expect.stringContaining(groupFile) });
    expect(report.errors[0].message).toContain(guidance);
    expect(compact.stderr).toContain(report.errors[0].message);
    const verbose = call("check", "--verbose");
    expect(verbose.status).toBe(2);
    expect(verbose.stdout).toContain(report.groups[0].errors[0].message);
    expect(verbose.stdout).toContain(guidance);
    if (scenario !== "broken JSON") {
      expect(report.groups[0].reason).toBe("理由を保持する");
      expect(verbose.stdout).toContain("Reason: 理由を保持する");
    }
    expect(call("confirm", "--all", "--snapshot", review).status).toBe(2);
    expect(readFileSync(groupFile, "utf8")).toBe(before);
    expect(readFileSync(join(root, "a"), "utf8")).toBe("a");
  },
);

it("keeps the lock and instructs checking for an active update before manual inspection", () => {
  const { root, call } = fixture();
  call("create", "api", "a", "b", "--reason", "理由");
  const file = join(root, ".crosslink/api.json");
  const review = join(root, "review.json");
  writeFileSync(review, call("check", "--json").stdout);
  const before = readFileSync(file, "utf8");
  writeFileSync(file + ".lock", "another writer");
  const result = call("confirm", file, "--snapshot", review, "--json");
  expect(result.status).toBe(2);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).errors).toEqual([
    {
      code: "GROUP_LOCKED",
      message: `Another update is in progress. Ensure no update is running before inspecting the lock: ${realpathSync(file)}.lock`,
    },
  ]);
  expect(readFileSync(file + ".lock", "utf8")).toBe("another writer");
  expect(readFileSync(file, "utf8")).toBe(before);
});

it("does not mistake a positional file named --json for an output option", () => {
  const { root, call } = fixture();
  writeFileSync(join(root, "--json"), "file");
  const result = call("create", "name", "--reason", "理由", "--", "--json", "a");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Saved.");
});

it("refuses two concurrent confirmation processes from the same snapshot", async () => {
  const { root, call } = fixture();
  call("create", "api", "a", "b", "--reason", "理由");
  const review = join(root, "review.json");
  writeFileSync(review, call("check", "--json").stdout);
  const results = await Promise.all(
    [0, 1].map(async () => {
      const { spawn } = await import("node:child_process");
      return new Promise<number | null>((done) => {
        const child = spawn(
          process.execPath,
          [join(root, "dist/cli.js"), "confirm", ".crosslink/api.json", "--snapshot", review],
          { cwd: root, stdio: "ignore" },
        );
        child.on("exit", done);
      });
    }),
  );
  expect(results.sort()).toEqual([0, 2]);
  expect(call("check").status).toBe(0);
});

it("accepts ordinary JSON data and rejects a declared record with a custom suffix in the built CLI", () => {
  const { root, call } = fixture();
  writeFileSync(
    join(root, "example.json"),
    JSON.stringify({ version: 1, name: "example", reason: "サンプル", files: ["a", "b"] }),
  );
  expect(call("create", "sample", "a", "example.json", "--reason", "通常データ").status).toBe(0);
  expect(
    call("create", "record", "a", "b", "--reason", "記録", "--file", "outside.record").status,
  ).toBe(0);
  const review = join(root, "review.json");
  writeFileSync(review, call("check", "--file", "outside.record", "--json").stdout);
  expect(call("confirm", "outside.record", "--snapshot", review).status).toBe(0);
  const rejected = call("add", ".crosslink/sample.json", "outside.record", "--json");
  expect(rejected.status).toBe(2);
  expect(JSON.parse(rejected.stdout).errors[0].code).toBe("MANAGEMENT_FILE");
});

it("prints English help with verbose and version options", () => {
  const { call } = fixture();
  const result = call("--help");
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("crosslink check");
  expect(result.stdout).toContain("-v, --verbose");
  expect(result.stdout).toContain("--version");
  expect(result.stdout).not.toMatch(/[ぁ-んァ-ヶ一-龯]/);
});

it("summarizes confirmed groups and lists only groups needing attention by default", () => {
  const { root, call } = fixture();
  expect(call("check").stdout).toBe("No registered groups.\n");
  call("create", "confirmed-group", "a", "b", "--reason", "confirmed reason");
  const review = join(root, "review.json");
  writeFileSync(review, call("check", "--json").stdout);
  expect(call("confirm", "--all", "--snapshot", review).status).toBe(0);
  const confirmed = call("check");
  expect(confirmed.status).toBe(0);
  expect(confirmed.stdout).toBe("Groups: 1 confirmed, 0 unconfirmed, 0 invalid.\n");
  call("create", "要確認", "a", "b", "--reason", "理由は保持する");
  call("create", "invalid-group", "--reason", "draft reason");
  const mixed = call("check");
  expect(mixed.status).toBe(2);
  expect(mixed.stdout).toContain("Groups: 1 confirmed, 1 unconfirmed, 1 invalid.");
  expect(mixed.stdout).toContain(`Unconfirmed: 要確認 (${join(".crosslink", "要確認.json")})`);
  expect(mixed.stdout).toContain("Invalid: invalid-group");
  expect(mixed.stdout).toContain("--verbose");
  expect(mixed.stdout).not.toContain("confirmed-group");
  expect(mixed.stdout).not.toContain("Reason:");
  expect(mixed.stdout).not.toContain("../a");
  expect(mixed.stderr).toContain("At least two files are required");
  const detailed = call("check", "--verbose");
  expect(detailed.status).toBe(2);
  expect(detailed.stdout).toContain("Confirmed: confirmed-group");
  expect(detailed.stdout).toContain("Unconfirmed: 要確認");
  expect(detailed.stdout).toContain("Invalid: invalid-group");
  expect(detailed.stdout).toContain("Reason: 理由は保持する");
  expect(detailed.stdout).toContain("Unchanged: ../b");
  const json = call("check", "--json");
  const verboseJson = call("check", "-v", "--json");
  expect(verboseJson.status).toBe(2);
  expect(verboseJson.stderr).toBe("");
  expect(JSON.parse(verboseJson.stdout)).toEqual(JSON.parse(json.stdout));
  expect(JSON.parse(json.stdout).groups).toHaveLength(3);
});

it.each(["-v", "--verbose"])(
  "shows all groups, reasons and file states with %s and preserves JSON",
  (flag) => {
    const { root, call } = fixture();
    call("create", "api", "a", "b", "--reason", "利用者の理由");
    const review = join(root, "review.json");
    const initial = call("check", flag);
    expect(initial.status).toBe(1);
    expect(initial.stdout).toContain("New: ../a");
    writeFileSync(review, call("check", "--json").stdout);
    expect(call("confirm", "--all", "--snapshot", review).status).toBe(0);
    expect(call("check", flag).stdout).toContain("Confirmed: api");
    writeFileSync(join(root, "a"), "changed");
    const detailed = call("check", flag);
    expect(detailed.status).toBe(1);
    expect(detailed.stdout).toContain("Unconfirmed: api");
    expect(detailed.stdout).toContain("Reason: 利用者の理由");
    expect(detailed.stdout).toContain("Changed: ../a");
    expect(detailed.stdout).toContain("Unchanged: ../b");
    const plain = call("check", "--json");
    const verbose = call("check", flag, "--json");
    expect(verbose.status).toBe(1);
    expect(verbose.stderr).toBe("");
    expect(JSON.parse(verbose.stdout)).toEqual(JSON.parse(plain.stdout));
    const report = JSON.parse(verbose.stdout);
    expect(report.version).toBe(1);
    expect(report.groups[0].reason).toBe("利用者の理由");
    expect(report.groups[0].files).toHaveLength(2);
    expect(report.groups[0].files[0].hash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.groups[0].snapshot).toMatch(/^[a-f0-9]{64}$/);
  },
);

it("prints English diagnostics from CLI, domain, application and filesystem rules", () => {
  const { root, call } = fixture();
  const cases = [
    ["unknown"],
    ["check", "--all"],
    ["create", "api"],
    ["create", "dup", "a", "a", "--reason", "reason"],
    ["create", "empty", "a", "b", "--reason", " "],
    ["create", "missing", "missing", "b", "--reason", "reason"],
    ["confirm"],
  ];
  for (const args of cases) {
    const result = call(...args);
    expect(result.status).toBe(2);
    expect(result.stderr).not.toBe("");
    expect(result.stderr).not.toMatch(/[ぁ-んァ-ヶ一-龯]/);
  }
  call("create", "api", "a", "b", "--reason", "reason");
  expect(call("remove", ".crosslink/api.json", "package.json").stderr).toContain(
    "Not a registered member:",
  );
  writeFileSync(join(root, ".crosslink/api.json"), "{");
  const broken = call("check", "--json");
  expect(broken.status).toBe(2);
  expect(JSON.parse(broken.stdout).errors[0].message).toContain("Invalid management JSON");
  writeFileSync(join(root, "crosslink.config.json"), '{"directoryName":"bad/path"}');
  expect(call("check").stderr).toContain("directoryName must be a single directory name");
});

it("reads the application version instead of a different working directory package", () => {
  const { root, call } = fixture();
  const expected = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  expect(call("--version").stdout).toBe(expected + "\n");
  expect(call("--version").status).toBe(0);
  const project = mkdtempSync(join(tmpdir(), "crosslink-version-cwd-"));
  roots.push(project);
  writeFileSync(join(project, "package.json"), '{"version":"999.0.0"}');
  writeFileSync(join(project, "crosslink.config.json"), "{");
  const result = spawnSync(process.execPath, [join(root, "dist/cli.js"), "--version"], {
    cwd: project,
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe(expected + "\n");
  const json = JSON.parse(call("--version", "--json").stdout);
  expect(json.version).toBe(1);
  expect(json.operation).toBe("version");
  expect(json.messages).toEqual([expected]);
});

it.each(["-v", "--verbose", "--version", "--help", "--json"])(
  "keeps the filename %s after -- positional",
  (file) => {
    const { root, call } = fixture();
    writeFileSync(join(root, file), "file");
    const result = call("create", "name", "--reason", "理由", "--", file, "a");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Saved.");
    const group = JSON.parse(readFileSync(join(root, ".crosslink/name.json"), "utf8"));
    expect(group.files).toContain("../" + file);
  },
);

it.each(
  [
    ["check", "--version"],
    ["--version", "--config", ""],
    ["--version", "--config", "settings.json"],
    ["--version", "-v"],
  ].map((args) => ({ args })),
)("rejects incompatible version arguments $args", ({ args }) => {
  const { call } = fixture();
  const result = call(...args);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("INVALID_ARGUMENT");
});

it("generates HTML with Node alone, resolves links from another output directory and preserves snapshots", () => {
  const { root, call } = fixture();
  call("create", "first", "a", "b", "--reason", "AとB");
  call("create", "second", "a", "package.json", "--reason", "AとC");
  const review = join(root, "review.json");
  writeFileSync(review, call("check", "--json").stdout);
  expect(call("confirm", "--all", "--snapshot", review).status).toBe(0);
  writeFileSync(join(root, "a"), "changed");
  const before = readFileSync(join(root, ".crosslink/first.json"), "utf8");
  const output = join(root, "dist/report.html");
  const report = call("report", "--format", "html", "--output", output, "--json");
  expect(report.status).toBe(1);
  expect(report.stderr).toBe("");
  expect(JSON.parse(report.stdout).groups).toEqual(
    JSON.parse(call("check", "--json").stdout).groups,
  );
  const html = readFileSync(output, "utf8");
  expect(html).toContain("2 direct groups");
  expect(html).toContain("Changed");
  expect(html).toContain("Unchanged");
  expect(html).toContain('href="file:');
  expect(html).toContain("AとB");
  expect(readFileSync(join(root, ".crosslink/first.json"), "utf8")).toBe(before);
  const retry = call("report", "--format", "html", "--output", output, "--json");
  expect(retry.status).toBe(2);
  expect(JSON.parse(retry.stdout).errors.at(-1).code).toBe("REPORT_EXISTS");
  expect(readFileSync(output, "utf8")).toBe(html);
  writeFileSync(review, call("check", "--json").stdout);
  call("confirm", ".crosslink/first.json", "--snapshot", review);
  const regenerated = call("report", "--format", "html", "--output", "partial.html", "--json");
  expect(regenerated.status).toBe(1);
  expect(
    JSON.parse(regenerated.stdout).groups.map((group: { status: string }) => group.status),
  ).toEqual(["confirmed", "unconfirmed"]);
});

it("runs dynamic membership with only Node, from another CWD and without Git or shell expansion", () => {
  const { root } = fixture();
  const project = join(root, "project [draft] (1)");
  mkdirSync(join(project, "adr"), { recursive: true });
  mkdirSync(join(project, "records"));
  writeFileSync(join(project, "design.bin"), Buffer.from([0, 255]));
  writeFileSync(join(project, "adr/one.md"), "same");
  writeFileSync(join(project, "adr/two.md"), "same");
  const call = (...args: string[]) =>
    spawnSync(process.execPath, [join(root, "dist/cli.js"), ...args], {
      cwd: project,
      env: { ...process.env, PATH: "", NODE_PATH: "", NODE_OPTIONS: "" },
      encoding: "utf8",
    });
  const file = join(realpathSync(project), "records/adr.record");
  const created = call(
    "create",
    "ADR",
    "design.bin",
    "--glob",
    "adr/**/*.md",
    "--file",
    file,
    "--reason",
    "増減を確認",
  );
  expect(created.status, created.stderr).toBe(0);
  expect(JSON.parse(readFileSync(file, "utf8")).globs).toEqual(["../adr/**/*.md"]);
  const review = join(project, "review.json");
  const check = () => call("check", "--file", file, "--json");
  const confirm = () => {
    writeFileSync(review, check().stdout);
    expect(call("confirm", file, "--snapshot", review).status).toBe(0);
  };
  confirm();
  writeFileSync(join(project, "adr/added.md"), "same");
  // 失敗した同じ一回のJSON/標準エラー/プロセス結果を残し、再実行で置き換えない。
  const addedCheck = check();
  expect(
    addedCheck.status,
    JSON.stringify({
      stdout: addedCheck.stdout,
      stderr: addedCheck.stderr,
      status: addedCheck.status,
      signal: addedCheck.signal,
      error: addedCheck.error?.message ?? null,
    }),
  ).toBe(1);
  const before = readFileSync(file, "utf8");
  expect(call("confirm", file, "--snapshot", review).status).toBe(2);
  expect(readFileSync(file, "utf8")).toBe(before);
  confirm();
  renameSync(join(project, "adr/added.md"), join(project, "adr/renamed.md"));
  const renamed = JSON.parse(check().stdout).groups[0];
  expect(renamed.added).toEqual(["../adr/renamed.md"]);
  expect(renamed.removed.map((f: { path: string }) => f.path)).toEqual(["../adr/added.md"]);
  const report = call("report", "--file", file, "--format", "html", "--output", "report.html");
  expect(report.status).toBe(1);
  const html = readFileSync(join(project, "report.html"), "utf8");
  expect(html).toContain("Removed since last confirmation (1)");
  expect(html).toContain("Glob selectors");
  confirm();
  rmSync(join(project, "adr/renamed.md"));
  expect(check().status).toBe(1);
  confirm();
  expect(check().status).toBe(0);
});

it("preserves a confirmed version 1 record produced by the 0.4.0 CLI byte for byte", () => {
  const { root, call } = fixture();
  mkdirSync(join(root, ".crosslink"));
  // db377628のCLIで実際に作成・確認した固定fixture。新しいcanonicalで作り直さない。
  const record = {
    kind: "crosslink-group",
    version: 1,
    name: "legacy",
    reason: "legacy",
    files: ["../a", "../b"],
    confirmation: {
      definition: "b357edf387f0b6507a04c2794bc8d9a29fd2b89de91d5f1ae438463a11f935cf",
      hashes: {
        "../a": "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
        "../b": "06eb7d6a69ee19e5fbdf749018d3d2abfa04bcbd1365db312eb86dc7169389b8",
      },
    },
  };
  const file = join(root, ".crosslink/legacy.json");
  const before = JSON.stringify(record, null, 2) + "\n";
  writeFileSync(file, before);
  const result = call("check", "--json");
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).groups[0].status).toBe("confirmed");
  expect(readFileSync(file, "utf8")).toBe(before);
});

it("preserves leading bang CWD selectors through built CLI create, confirm, add and remove", () => {
  const { root } = fixture(),
    cwd = join(root, "!inputs");
  mkdirSync(cwd);
  for (const file of ["a.md", "b.md"]) writeFileSync(join(cwd, file), "ADR\n");
  const call = (...args: string[]) =>
    spawnSync(process.execPath, [join(root, "dist/cli.js"), ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, PATH: "", NODE_PATH: "", NODE_OPTIONS: "" },
    });
  const created = call(
    "create",
    "bang",
    "--file",
    "../bang.record",
    "--glob",
    "*.md",
    "--reason",
    "literal CWD",
    "--json",
  );
  expect(created.status, created.stdout + created.stderr).toBe(0);
  const record = join(root, "bang.record"),
    review = join(root, "review.json");
  expect(JSON.parse(readFileSync(record, "utf8"))).toMatchObject({
    files: [],
    globs: ["./!inputs/*.md"],
  });
  function confirm() {
    const checked = call("check", "--file", "../bang.record", "--json");
    expect(checked.status).toBe(1);
    expect(JSON.parse(checked.stdout).groups[0].files).toHaveLength(2);
    writeFileSync(review, checked.stdout);
    const confirmed = call("confirm", "../bang.record", "--snapshot", "../review.json", "--json");
    expect(confirmed.status, confirmed.stdout + confirmed.stderr).toBe(0);
  }
  confirm();
  const before = readFileSync(record, "utf8");
  expect(call("add", "../bang.record", "--glob", "!*.md", "--json").status).toBe(2);
  expect(readFileSync(record, "utf8")).toBe(before);
  expect(call("remove", "../bang.record", "--glob", "*.md", "--json").status).toBe(0);
  expect(call("add", "../bang.record", "--glob", "*.md", "--json").status).toBe(0);
  expect(JSON.parse(readFileSync(record, "utf8")).globs).toEqual(["./!inputs/*.md"]);
  confirm();
});

it("keeps built HTML file indexes incomplete for failed scope and unreadable definitions", () => {
  const { root, call } = fixture();
  writeFileSync(join(root, "crosslink.config.json"), "{ broken");
  const scope = call("report", "--format", "html", "--output", "scope.html", "--json");
  expect(scope.status).toBe(2);
  function assertIncomplete(file: string) {
    const html = readFileSync(join(root, file), "utf8");
    const index = html.slice(html.indexOf('<section id="files"'));
    expect(index).not.toContain("All 0 member files");
    expect(index).not.toContain("No member files available");
    expect(index).toContain("total member file count is unknown");
    expect(html).toContain('href="#files">File index (incomplete)');
  }
  assertIncomplete("scope.html");
  rmSync(join(root, "crosslink.config.json"));
  mkdirSync(join(root, ".crosslink"));
  writeFileSync(join(root, ".crosslink/broken.json"), "{ broken");
  expect(call("report", "--format", "html", "--output", "definition.html", "--json").status).toBe(
    2,
  );
  assertIncomplete("definition.html");
});

it.skipIf(process.platform === "win32")(
  "keeps a known file index complete when a real member file becomes unreadable",
  () => {
    const { root, call } = fixture();
    expect(call("create", "unreadable", "b", "--glob", "a", "--reason", "readability").status).toBe(
      0,
    );
    const review = join(root, "review.json"),
      record = join(root, ".crosslink/unreadable.json");
    writeFileSync(review, call("check", "--json").stdout);
    expect(call("confirm", ".crosslink/unreadable.json", "--snapshot", review).status).toBe(0);
    const before = readFileSync(record, "utf8"),
      target = join(root, "a"),
      mode = statSync(target).mode & 0o777;
    chmodSync(target, 0);
    try {
      expect(() => readFileSync(target)).toThrow(expect.objectContaining({ code: "EACCES" }));
      const result = call("report", "--format", "html", "--output", "unreadable.html", "--json");
      expect(result.status).toBe(2);
      const group = JSON.parse(result.stdout).groups[0];
      expect(group.membershipComplete).toBe(true);
      expect(group.files.find((file: { path: string }) => file.path === "../a").hash).toBeNull();
      expect(group.errors.map((error: { code: string }) => error.code)).toEqual([
        "FILE_UNREADABLE",
      ]);
      const html = readFileSync(join(root, "unreadable.html"), "utf8"),
        index = html.slice(html.indexOf('<section id="files"'));
      expect(html).toContain('class="badge unreadable">Unreadable');
      expect(html).toContain('href="#files">File index (2)');
      expect(index).toContain("All 2 member files");
      expect(index).not.toContain("total member file count is unknown");
      expect(readFileSync(record, "utf8")).toBe(before);
    } finally {
      chmodSync(target, mode);
    }
    expect(readFileSync(target, "utf8")).toBe("a");
  },
);

it("runs directional roles with Node alone, preserves source context and rejects stale target snapshots", () => {
  const { root, call } = fixture();
  const diagnostic = (result: ReturnType<typeof call>) =>
    JSON.stringify({
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
    });
  const invoke = (...args: string[]) => {
    const result = call(...args);
    expect(result.status, diagnostic(result)).toBe(0);
    return result;
  };
  invoke("create", "direction", "a", "--role", "source-only", "--reason", "ADR → code");
  invoke("add", ".crosslink/direction.json", "b", "--role", "target-only");
  const review = join(root, "review.json"),
    file = join(root, ".crosslink/direction.json");
  writeFileSync(review, call("check", "--json").stdout);
  invoke("confirm", "--all", "--snapshot", review);
  const snapshot = call("check", "--json");
  writeFileSync(review, snapshot.stdout);
  writeFileSync(join(root, "b"), "target changed");
  invoke("check");
  const before = readFileSync(file, "utf8");
  const stale = call("confirm", "--all", "--snapshot", review, "--json");
  expect(stale.status, diagnostic(stale)).toBe(2);
  expect(JSON.parse(stale.stdout).errors[0].code).toBe("STALE_SNAPSHOT");
  expect(readFileSync(file, "utf8")).toBe(before);
  const related = invoke("related", "b", "--json");
  expect(JSON.parse(related.stdout).groups[0].reviewTargets).toEqual(["../b"]);
  const verbose = invoke("check", "-v");
  expect(verbose.stdout).toContain("Target only · Changed: ../b");
  expect(verbose.stdout).toContain("No unreviewed source impact");
  writeFileSync(join(root, "a"), "source changed");
  const changed = call("check", "--json");
  expect(changed.status, diagnostic(changed)).toBe(1);
  expect(JSON.parse(changed.stdout).groups[0].sourceChanges).toEqual(["../a"]);
  writeFileSync(join(root, "a"), "a");
  invoke("check");
});
it("preserves a confirmed version 2 record produced by the 0.5.0 CLI byte for byte", () => {
  const { root, call } = fixture();
  writeFileSync(join(root, "b"), "b");
  mkdirSync(join(root, ".crosslink"));
  // main 3b8ed13 のCLIで生成・確認した記録。現実装で再生成しない。
  const record =
    JSON.stringify(
      {
        kind: "crosslink-group",
        version: 2,
        name: "legacy-glob",
        reason: "old",
        files: ["../a"],
        globs: ["../b"],
        confirmation: {
          definition: "58ac3f10e8903005e6575302884c84e82ebf116b255642a7bc30875c59db962c",
          hashes: {
            "../a": "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
            "../b": "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d",
          },
        },
      },
      null,
      2,
    ) + "\n";
  const file = join(root, ".crosslink/legacy-glob.json");
  writeFileSync(file, record);
  const checked = call("check", "--json");
  expect(checked.status, checked.stdout + checked.stderr).toBe(0);
  expect(JSON.parse(checked.stdout).groups[0]).not.toHaveProperty("roles");
  expect(readFileSync(file, "utf8")).toBe(record);
});

it("edits glob roles through a group parent alias using the same selectors as creation", () => {
  const { root, call } = fixture();
  expect(
    call("create", "alias-base", "a", "--glob", "b", "--role", "source-only", "--reason", "alias")
      .status,
  ).toBe(0);
  const file = join(root, ".crosslink/alias-base.json");
  const result = call("role", file, "--glob", "b", "--role", "target-only", "--json");
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(JSON.parse(readFileSync(file, "utf8")).roles.globs).toEqual({ "../b": "target-only" });
});
