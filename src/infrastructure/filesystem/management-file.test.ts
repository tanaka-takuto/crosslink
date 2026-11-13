import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { isManagementFile, readGroup } from "./management-file.js";
import { defaults } from "./settings.js";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "crosslink-management-"));
  roots.push(root);
  mkdirSync(join(root, ".crosslink"));
  const file = join(root, ".crosslink", "group.json");
  const group = { version: 1, name: "group", reason: "関連", files: ["../a", "../b"] };
  writeFileSync(file, JSON.stringify(group));
  return { root, file, group };
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it("reads the definition and original bytes without rewriting the management file", () => {
  const { file, group } = fixture();
  const raw = readFileSync(file, "utf8");
  expect(readGroup(file)).toEqual({ group, raw });
  expect(readFileSync(file, "utf8")).toBe(raw);
});

it("refuses explicitly marked management JSON outside the default directory", () => {
  const { root, file, group } = fixture();
  const member = join(root, "outside.json");
  writeFileSync(member, JSON.stringify({ kind: "crosslink-group", ...group }));
  expect(isManagementFile(member, file, defaults)).toBe(true);
});

it("accepts ordinary JSON resembling a legacy group definition", () => {
  const { root, file, group } = fixture();
  const member = join(root, "example.json");
  writeFileSync(member, JSON.stringify(group));
  expect(isManagementFile(member, file, defaults)).toBe(false);
});

it.each([
  { value: { kind: "example", version: 1, name: "sample", reason: "data", files: ["a", "b"] } },
  { value: { sample: { kind: "crosslink-group" } } },
  { value: [{ kind: "crosslink-group" }] },
])(
  "does not infer a top-level management role from unrelated or nested markers: $value",
  ({ value }) => {
    const { root, file } = fixture();
    const member = join(root, "sample.data");
    writeFileSync(member, JSON.stringify(value));
    expect(isManagementFile(member, file, defaults)).toBe(false);
  },
);

it("detects a declared kind after whitespace, a BOM and reordered fields without relying on extension", () => {
  const { root, file } = fixture();
  const member = join(root, "record");
  writeFileSync(
    member,
    "\uFEFF" +
      " ".repeat(5000) +
      JSON.stringify({ version: 999, note: "x".repeat(5000), kind: "crosslink-group" }),
  );
  expect(isManagementFile(member, file, defaults)).toBe(true);
});
