import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
