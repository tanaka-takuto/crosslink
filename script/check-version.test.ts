import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  expect(run(base).status).toBe(0);
  expect(run("f".repeat(40)).status).toBe(1);
  expect(run("--help").status).toBe(1);
});
