import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { digest, hashFile } from "./content-hash.js";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "crosslink-hash-"));
  roots.push(root);
  return root;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it("hashes binary bytes without decoding or modifying the file", () => {
  const file = join(fixture(), "data");
  const bytes = Buffer.from([0, 255, 128]);
  writeFileSync(file, bytes);
  expect(hashFile(file).hash).toBe(digest(bytes));
  expect(hashFile(file).hash).not.toBe(digest(bytes.toString("utf8")));
  expect(readFileSync(file)).toEqual(bytes);
});

it("uses current content rather than timestamps to detect changes", () => {
  const file = join(fixture(), "data");
  writeFileSync(file, "original");
  const original = hashFile(file).hash;
  const time = new Date("2020-01-01T00:00:00Z");
  utimesSync(file, time, time);
  expect(hashFile(file).hash).toBe(original);
  writeFileSync(file, "different");
  utimesSync(file, time, time);
  expect(hashFile(file).hash).not.toBe(original);
  writeFileSync(file, "original");
  expect(hashFile(file).hash).toBe(original);
});

it("fails for missing paths and directories instead of treating them as file content", () => {
  const root = fixture();
  mkdirSync(join(root, "folder"));
  expect(() => hashFile(join(root, "folder"))).toThrow(
    expect.objectContaining({ code: "NOT_A_FILE" }),
  );
  expect(() => hashFile(join(root, "missing"))).toThrow();
});
