import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { binaryName } from "./build-binary.ts";

const project = fileURLToPath(new URL("../", import.meta.url));
const artifact = resolve(project, "tmp/bin", binaryName());
const roots: string[] = [];

function fixture() {
  // リポジトリの探索対象へ試験用グループを混ぜず、実行ファイルだけを持ち出す。
  const root = mkdtempSync(join(tmpdir(), "crosslink-binary-"));
  roots.push(root);
  const executable = join(root, binaryName());
  copyFileSync(artifact, executable);
  if (process.platform !== "win32") chmodSync(executable, 0o755);
  // Windowsでは環境変数名の大文字・小文字を区別しないため、既存のPathも取り除く。
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !["path", "node_path", "node_options"].includes(key.toLowerCase()),
    ),
  );
  const call = (...args: string[]) =>
    spawnSync(executable, args, {
      cwd: root,
      env: { ...env, PATH: "", NODE_PATH: "", NODE_OPTIONS: "" },
      encoding: "utf8",
      timeout: 15_000,
    });
  return { root, executable, call };
}

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it("names native artifacts by OS/CPU and gives Windows an exe suffix", () => {
  expect(binaryName("darwin", "arm64")).toBe("crosslink-darwin-arm64");
  expect(binaryName("linux", "x64")).toBe("crosslink-linux-x64");
  expect(binaryName("win32", "x64")).toBe("crosslink-win32-x64.exe");
});

describe("standalone SEA", () => {
  it("ships a checksum of the final executable and native execution permissions", () => {
    expect(statSync(artifact).size).toBeGreaterThan(0);
    const hash = createHash("sha256").update(readFileSync(artifact)).digest("hex");
    expect(readFileSync(`${artifact}.sha256`, "utf8")).toBe(`${hash}  ${binaryName()}\n`);
    if (process.platform !== "win32") expect(statSync(artifact).mode & 0o777).toBe(0o755);
    if (process.platform === "darwin") {
      const verified = spawnSync("/usr/bin/codesign", ["--verify", "--strict", artifact], {
        encoding: "utf8",
      });
      expect(verified.status, verified.stderr).toBe(0);
    }
  });

  it("runs help with only the executable and an empty PATH", () => {
    const { root, call } = fixture();
    expect(readdirSync(root)).toEqual([binaryName()]);
    expect(existsSync(join(root, "node_modules"))).toBe(false);
    const help = call("--help");
    expect(help.error).toBeUndefined();
    expect(help.status, help.stderr).toBe(0);
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain("crosslink");
    expect(help.stdout).toContain("create");
    expect(help.stdout).toContain("confirm");
  });

  it("reports its bundled version even when the working directory has a different package.json", () => {
    const { root, call } = fixture();
    writeFileSync(join(root, "package.json"), '{"version":"999.0.0","type":"commonjs"}');
    const version = JSON.parse(readFileSync(join(project, "package.json"), "utf8")).version;
    const result = call("--version");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(version);
  });

  it("creates, checks, confirms and detects changes on the real working filesystem", () => {
    const { root, call } = fixture();
    writeFileSync(join(root, "a.md"), "specification\n");
    writeFileSync(join(root, "b.bin"), Buffer.from([0, 255, 1]));
    const created = call("create", "配布", "a.md", "b.bin", "--reason", "仕様との整合性", "--json");
    expect(created.status, created.stderr).toBe(0);
    expect(created.stderr).toBe("");
    expect(JSON.parse(created.stdout).result).toBe("ok");
    const groupFile = join(root, ".crosslink/配布.json");
    const original = readFileSync(groupFile, "utf8");
    const checked = call("check", "--json");
    expect(checked.status, checked.stderr).toBe(1);
    expect(checked.stderr).toBe("");
    const report = JSON.parse(checked.stdout);
    expect(report.result).toBe("unconfirmed");
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].name).toBe("配布");
    expect(report.groups[0].reason).toBe("仕様との整合性");
    expect(report.groups[0].files).toHaveLength(2);
    expect(readFileSync(groupFile, "utf8")).toBe(original);
    const snapshot = join(root, "review.json");
    writeFileSync(snapshot, checked.stdout);
    const confirmed = call("confirm", ".crosslink/配布.json", "--snapshot", snapshot, "--json");
    expect(confirmed.status, confirmed.stderr).toBe(0);
    expect(JSON.parse(confirmed.stdout).result).toBe("ok");
    const clean = call("check", "--json");
    expect(clean.status, clean.stderr).toBe(0);
    expect(JSON.parse(clean.stdout).groups[0].status).toBe("confirmed");
    const human = call("check");
    expect(human.status, human.stderr).toBe(0);
    expect(human.stdout).toContain("配布");
    writeFileSync(join(root, "b.bin"), "changed\n");
    const changed = call("check", "--json");
    expect(changed.status, changed.stderr).toBe(1);
    expect(changed.stderr).toBe("");
    const changedReport = JSON.parse(changed.stdout);
    expect(changedReport.result).toBe("unconfirmed");
    expect(
      changedReport.groups[0].files.filter((file: { changed: boolean }) => file.changed),
    ).toHaveLength(1);
    expect(call("confirm", ".crosslink/配布.json", "--snapshot", snapshot).status).toBe(2);
    expect(readFileSync(join(root, "b.bin"), "utf8")).toBe("changed\n");
  });

  it("keeps invocation errors as one JSON object on stdout without Node", () => {
    const { call } = fixture();
    const rejected = call("check", "--unknown", "--json");
    expect(rejected.status, rejected.stderr).toBe(2);
    expect(rejected.stderr).toBe("");
    expect(JSON.parse(rejected.stdout).result).toBe("error");
  });
});
