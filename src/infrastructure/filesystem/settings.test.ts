import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { problem } from "../../domain/errors.js";
import { defaults, findGroups, groupFile, loadSettings } from "./settings.js";

vi.mock("node:fs", async (original) => ({ ...(await original<typeof import("node:fs")>()) }));

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
it.each([undefined, "config/../設定 ' $().json"])(
  "guides malformed configuration JSON at its resolved path: %s",
  (config) => {
    const root = fixture();
    mkdirSync(join(root, "config"));
    const file = join(root, config ?? "crosslink.config.json");
    writeFileSync(file, "{");
    let cause = "";
    try {
      JSON.parse("{");
    } catch (error) {
      cause = (error as Error).message;
    }
    try {
      loadSettings(root, config);
      expect.fail("Malformed configuration must fail");
    } catch (error) {
      const diagnostic = problem(error);
      expect(diagnostic.code).toBe("IO_ERROR");
      expect(diagnostic.message).toContain(resolve(root, config ?? "crosslink.config.json"));
      expect(diagnostic.message).toContain("Invalid configuration JSON");
      expect(diagnostic.message).toContain(cause);
      expect(diagnostic.message).toContain(
        "Repair the configuration JSON or restore a valid copy, then run check again.",
      );
    }
    expect(fs.readFileSync(file, "utf8")).toBe("{");
  },
);

it.each([
  { value: null, cause: "Configuration must be a JSON object." },
  { value: [], cause: "Configuration must be a JSON object." },
  { value: { unknown: true }, cause: "Unsupported configuration fields." },
  { value: { directoryName: 1 }, cause: "directoryName must be a single directory name." },
  { value: { directoryName: "../links" }, cause: "directoryName must be a single directory name." },
  ...[1, "group.json", "{name}{name}.json", "{name}.txt", "../{name}.json"].map(
    (fileNameTemplate) => ({
      value: { fileNameTemplate },
      cause: "fileNameTemplate must be a JSON filename containing exactly one {name}.",
    }),
  ),
])(
  "guides invalid configuration values without changing their code: $value",
  ({ value, cause }) => {
    const root = fixture();
    const file = join(root, "crosslink.config.json");
    const bytes = JSON.stringify(value);
    writeFileSync(file, bytes);
    expect(() => loadSettings(root)).toThrow(
      expect.objectContaining({
        code: "INVALID_CONFIG",
        message: expect.stringContaining(`Invalid configuration JSON: ${file}. ${cause}`),
      }),
    );
    expect(() => loadSettings(root)).toThrow(
      "Repair the configuration JSON or restore a valid copy, then run check again.",
    );
    expect(fs.readFileSync(file, "utf8")).toBe(bytes);
  },
);

it.each(["missing.json", "directory"])(
  "keeps the actual configuration read cause for %s",
  (config) => {
    const root = fixture();
    mkdirSync(join(root, "directory"));
    const file = join(root, config);
    let cause = "";
    try {
      fs.readFileSync(file, "utf8");
    } catch (error) {
      cause = (error as Error).message;
    }
    try {
      loadSettings(root, config);
      expect.fail("Unreadable configuration must fail");
    } catch (error) {
      const diagnostic = problem(error);
      expect(diagnostic.code).toBe("IO_ERROR");
      expect(diagnostic.message).toContain(`Cannot read configuration JSON: ${file}. ${cause}`);
      expect(diagnostic.message).toContain(
        "Check that the configuration file exists and is readable, then run check again.",
      );
      expect(diagnostic.message).not.toContain("Repair the configuration JSON");
    }
  },
);

it("keeps an access-denied configuration cause without calling it malformed JSON", () => {
  const root = fixture(),
    file = join(root, "crosslink.config.json");
  writeFileSync(file, "{}");
  const cause = new Error("EACCES: permission denied by fixture policy");
  const read = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
    throw cause;
  });
  try {
    expect(() => loadSettings(root)).toThrow(
      expect.objectContaining({
        code: "IO_ERROR",
        message: `Cannot read configuration JSON: ${file}. ${cause.message} Check that the configuration file exists and is readable, then run check again.`,
      }),
    );
  } finally {
    read.mockRestore();
  }
  expect(fs.readFileSync(file, "utf8")).toBe("{}");
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
