import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { Group } from "../../domain/group.js";
import { readGroup } from "./management-file.js";
import { saveGroup, withLocks } from "./group-storage.js";

const roots: string[] = [];
const group: Group = { name: "api", reason: "関連する内容を確認", files: ["../a", "../b"] };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "crosslink-storage-"));
  roots.push(root);
  mkdirSync(join(root, ".crosslink"));
  return join(root, ".crosslink", "group.json");
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it("writes the declared format and refuses to replace an existing file during creation", () => {
  const file = fixture();
  saveGroup(file, group, true);
  const before = readFileSync(file, "utf8");
  expect(readGroup(file).group).toEqual({ kind: "crosslink-group", version: 1, ...group });
  expect(() => saveGroup(file, { ...group, name: "other" }, true)).toThrow();
  expect(readFileSync(file, "utf8")).toBe(before);
  saveGroup(file, { ...group, name: "other" });
  expect(readGroup(file).group.name).toBe("other");
});

it("retains another writer's lock and releases its own locks when work fails", () => {
  const file = fixture();
  const other = file + ".other";
  writeFileSync(other + ".lock", "another writer");
  expect(() => withLocks([file, other], () => undefined)).toThrow(
    expect.objectContaining({ code: "GROUP_LOCKED" }),
  );
  expect(readFileSync(other + ".lock", "utf8")).toBe("another writer");
  expect(existsSync(file + ".lock")).toBe(false);
  expect(() =>
    withLocks([file], () => {
      throw new Error("failed work");
    }),
  ).toThrow("failed work");
  expect(existsSync(file + ".lock")).toBe(false);
});
