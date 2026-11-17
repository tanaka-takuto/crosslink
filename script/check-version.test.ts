import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { validateVersion } from "./check-version.ts";

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);

describe("SemVer 2.0.0 and base comparison", () => {
  it.each([
    "0.0.0",
    "1.2.3",
    "1.2.3-alpha.1",
    "1.2.3-0",
    "1.2.3-1a.01a",
    "1.2.3+001",
    "1.2.3-beta.1+build.001",
    "99999999999999999999.0.0",
  ])("accepts valid version %s", (version) => {
    expect(validateVersion({ version, private: true }, "0.1.1")).toBe(version);
  });
  it.each([
    "v1.2.3",
    "1.2",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.2.3-01",
    "1.2.3-a.01",
    "1.2.3-",
    "1.2.3+",
    "1.2.3-a..b",
    "1.2.3+a..b",
    "1.2.3_foo",
    "1.2.3\n",
    " 1.2.3",
    123,
    null,
    undefined,
  ])("rejects invalid version %s", (version) => {
    expect(() => validateVersion({ version, private: true }, "0.1.1")).toThrow(/SemVer/);
  });
  it("rejects an unchanged version, including prerelease and build metadata", () => {
    expect(() =>
      validateVersion({ version: "1.2.3-rc.1+42", private: true }, "1.2.3-rc.1+42"),
    ).toThrow(/differ/);
  });
  it("accepts a changed version without inventing an increase policy", () => {
    expect(validateVersion({ version: "0.3.1", private: true }, "1.0.0")).toBe("0.3.1");
    expect(validateVersion({ version: "1.2.3+2", private: true }, "1.2.3+1")).toBe("1.2.3+2");
  });
  it("requires private true", () => {
    expect(() => validateVersion({ version: "0.3.1", private: false }, "0.3.0")).toThrow(/private/);
  });
});

it("CLI compares the specified base package and fails closed for a missing base", () => {
  const cwd = mkdtempSync(join(tmpdir(), "crosslink-version-"));
  directories.push(cwd);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  git("init");
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ version: "0.3.0", private: true }));
  git("add", "package.json");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    "fixture",
  );
  const base = git("rev-parse", "HEAD");
  const script = resolve("script/check-version.ts");
  const run = (ref: string) =>
    spawnSync(process.execPath, [script, "--base", ref], { cwd, encoding: "utf8" });
  expect(run(base).status).toBe(1);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ version: "0.3.1", private: true }));
  const valid = run(base);
  expect(valid.status, valid.stderr).toBe(0);
  expect(valid.stdout).toBe("Version policy passed: 0.3.1\n");
  expect(run("f".repeat(40)).status).toBe(1);
  expect(run("--help").status).toBe(1);
});

it("does not run the version CLI when imported by a module or eval", () => {
  const cwd = mkdtempSync(join(tmpdir(), "crosslink-version-import-"));
  directories.push(cwd);
  const code = `const module = await import(${JSON.stringify(pathToFileURL(resolve("script/check-version.ts")).href)}); if (module.validateVersion({version:"1.0.0",private:true}) !== "1.0.0") throw Error("Import failed"); console.log("imported");`;
  const runner = join(cwd, "runner.mjs");
  writeFileSync(runner, code);
  for (const args of [[runner, "--unsupported"], ["--input-type=module", "--eval", code, "missing-entry"]]) {
    const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("imported\n");
  }
});

it.each(["-e", "--eval", "--eval=", "-p", "--print", "-pe", "--print=true"])("does not write version output when %s imports argv[1] itself", (flag) => {
  const cwd = mkdtempSync(join(tmpdir(), "crosslink-version-eval-")); directories.push(cwd);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ version: "1.2.3", private: true }));
  const output = join(cwd, "github-output"); writeFileSync(output, "unchanged\n");
  const print = ["-p", "--print", "-pe", "--print=true"].includes(flag);
  const code = print ? 'import(require("node:url").pathToFileURL(process.argv[1]).href).then(() => console.log("import-only"));' : 'import {pathToFileURL} from "node:url"; await import(pathToFileURL(process.argv[1]).href); console.log("import-only");';
  const args = [...(print ? [] : ["--input-type=module"]), ...(flag.endsWith("=") ? [flag + code] : [flag, code]), resolve("script/check-version.ts")];
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output } });
  expect(result.status, result.stderr).toBe(0);
  if (print) { expect(result.stdout.split("\n").filter(line => line === "import-only")).toHaveLength(1); expect(result.stdout).not.toContain("Version policy passed"); }
  else expect(result.stdout).toBe("import-only\n");
  expect(readFileSync(output, "utf8")).toBe("unchanged\n");
});

it("runs the version CLI directly through an existing native directory alias", () => {
  const cwd = mkdtempSync(join(tmpdir(), "crosslink-version-native-")); directories.push(cwd);
  mkdirSync(join(cwd, "café"));
  copyFileSync(resolve("script/check-version.ts"), join(cwd, "café/check-version.ts"));
  const alias = join(cwd, "cafe\u0301/check-version.ts");
  const entry = existsSync(alias) ? alias : join(cwd, "café/check-version.ts");
  expect(realpathSync.native(entry)).toBe(realpathSync.native(join(cwd, "café/check-version.ts")));
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ version: "1.2.3", private: true }));
  const output = join(cwd, "github-output");
  const result = spawnSync(process.execPath, [entry], { cwd, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output } });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("Version policy passed: 1.2.3\n");
  expect(readFileSync(output, "utf8")).toBe("version=1.2.3\n");
});
