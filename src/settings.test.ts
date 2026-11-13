import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defaults } from "./core.js";
import { findGroups, groupFile, loadSettings } from "./settings.js";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "crosslink-settings-"));
  roots.push(root);
  return root;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it("uses defaults without a configuration or initialization", () => {
  expect(loadSettings(fixture())).toEqual(defaults);
});
it("configures both directory and file names", () => {
  const root = fixture();
  writeFileSync(
    join(root, "crosslink.config.json"),
    JSON.stringify({ directoryName: ".links", fileNameTemplate: "group-{name}.json" }),
  );
  const settings = loadSettings(root);
  expect(settings.directoryName).toBe(".links");
  expect(groupFile("api", root, settings)).toBe(join(root, ".links", "group-api.json"));
});
it("finds nested group directories, ignores unrelated JSON and dependency/Git directories", () => {
  const root = fixture();
  for (const folder of [
    ".crosslink",
    "nested/.crosslink",
    "node_modules/a/.crosslink",
    ".git/.crosslink",
  ]) {
    mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(join(root, folder, "api.json"), "{}");
  }
  writeFileSync(join(root, "unrelated.json"), "{}");
  expect(findGroups(root, defaults)).toEqual([
    join(root, ".crosslink/api.json"),
    join(root, "nested/.crosslink/api.json"),
  ]);
});
it("fails for malformed configuration instead of silently selecting no groups", () => {
  const root = fixture();
  writeFileSync(join(root, "crosslink.config.json"), "{");
  expect(() => loadSettings(root)).toThrow();
});
it("rejects path traversal in a file-name template", () => {
  const root = fixture();
  writeFileSync(
    join(root, "crosslink.config.json"),
    JSON.stringify({ fileNameTemplate: "../{name}.json" }),
  );
  expect(() => loadSettings(root)).toThrow();
});

it("also discovers groups when the command starts inside the management directory", () => {
  const root = fixture();
  const store = join(root, ".crosslink");
  mkdirSync(store);
  writeFileSync(join(store, "api.json"), "{}");
  expect(findGroups(store, defaults)).toEqual([join(store, "api.json")]);
});
