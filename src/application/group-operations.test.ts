import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { Group } from "../domain/group.js";
import { inspectGroup as inspect } from "./inspect-group.js";
import { readGroup } from "../infrastructure/filesystem/management-file.js";
import { filesystemPorts } from "../infrastructure/filesystem/adapter.js";
import { defaults } from "../infrastructure/filesystem/settings.js";
import * as operations from "./group-operations.js";
const inspectGroup = (file: string) => inspect(file, filesystemPorts, defaults);
const confirmGroups = (files: string[], expected: Map<string, string>) =>
  operations.confirmGroups(files, expected, filesystemPorts, defaults);
const createGroup = (file: string, group: Group) =>
  operations.createGroup(file, group, filesystemPorts, defaults);
const updateGroup = (file: string, update: (group: Group) => Group) =>
  operations.updateGroup(file, update, filesystemPorts, defaults);

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "crosslink-store-"));
  roots.push(root);
  mkdirSync(join(root, ".crosslink"));
  writeFileSync(join(root, "a"), "a");
  writeFileSync(join(root, "b"), "b");
  const file = join(root, ".crosslink", "group.json");
  const group: Group = { name: "group", reason: "一緒に確認", files: ["../a", "../b"] };
  writeFileSync(file, JSON.stringify({ version: 1, ...group }));
  return { root, file, group };
}
function confirm(file: string) {
  confirmGroups([file], new Map([[file, inspectGroup(file).snapshot!]]));
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it("records explicit confirmation, detects either direction and restores identical content", () => {
  const { root, file } = fixture();
  confirm(file);
  expect(inspectGroup(file).status).toBe("confirmed");
  for (const member of ["a", "b"]) {
    writeFileSync(join(root, member), "changed");
    expect(inspectGroup(file).status).toBe("unconfirmed");
    writeFileSync(join(root, member), member);
    expect(inspectGroup(file).status).toBe("confirmed");
  }
});
it("refuses stale file contents without changing the record", () => {
  const { root, file } = fixture();
  const snapshot = inspectGroup(file).snapshot!;
  const before = readFileSync(file, "utf8");
  writeFileSync(join(root, "a"), "new");
  expect(() => confirmGroups([file], new Map([[file, snapshot]]))).toThrow(
    expect.objectContaining({
      code: "STALE_SNAPSHOT",
      message: expect.stringContaining("Run check --json again and read all related files"),
    }),
  );
  expect(readFileSync(file, "utf8")).toBe(before);
});
it("guides invalid groups through inspection and repair before explicit confirmation", () => {
  const { file } = fixture();
  updateGroup(file, (group) => ({ ...group, files: [] }));
  const before = readFileSync(file, "utf8");
  expect(() => confirmGroups([file], new Map([[file, "a".repeat(64)]]))).toThrow(
    expect.objectContaining({
      code: "INVALID_GROUP",
      message: expect.stringContaining(
        "Run check --verbose to locate and fix the problems, then read all related files",
      ),
    }),
  );
  expect(readFileSync(file, "utf8")).toBe(before);
});
it("refuses stale group definitions and metadata-only changes", () => {
  const { file, group } = fixture();
  const snapshot = inspectGroup(file).snapshot!;
  writeFileSync(file, JSON.stringify({ version: 1, ...group, reason: "別の理由" }));
  expect(() => confirmGroups([file], new Map([[file, snapshot]]))).toThrow();
});
it("guides a snapshot race during confirmation without saving an older definition", () => {
  const { file } = fixture();
  const old = filesystemPorts.groups.read(file);
  updateGroup(file, (group) => ({ ...group, reason: "新しい理由" }));
  const snapshot = inspectGroup(file).snapshot!;
  const before = readFileSync(file, "utf8");
  let reads = 0;
  const ports = {
    ...filesystemPorts,
    groups: {
      ...filesystemPorts.groups,
      read: (target: string) => (++reads === 1 ? old : filesystemPorts.groups.read(target)),
    },
  };
  expect(() =>
    operations.confirmGroups([file], new Map([[file, snapshot]]), ports, defaults),
  ).toThrow(
    expect.objectContaining({
      code: "STALE_SNAPSHOT",
      message: expect.stringContaining("Run check --json again and read all related files"),
    }),
  );
  expect(readFileSync(file, "utf8")).toBe(before);
});
it("supports 1/0 member drafts and invalidates previous confirmation on every membership edit", () => {
  const { file } = fixture();
  confirm(file);
  updateGroup(file, (g) => ({ ...g, files: ["../a"] }));
  expect(readGroup(file).group.files).toHaveLength(1);
  expect(inspectGroup(file).errors[0]?.code).toBe("TOO_FEW_FILES");
  updateGroup(file, (g) => ({ ...g, files: [] }));
  expect(readGroup(file).group.files).toHaveLength(0);
  updateGroup(file, (g) => ({ ...g, files: ["../a", "../b"] }));
  expect(inspectGroup(file).status).toBe("unconfirmed");
});
it("creates groups without replacing an existing file", () => {
  const { root, group } = fixture();
  const file = join(root, ".crosslink", "new.json");
  createGroup(file, group);
  expect(readGroup(file).group).toEqual({ kind: "crosslink-group", version: 1, ...group });
  expect(() => createGroup(file, group)).toThrow();
});
it("refuses confirmation files in create and update operations", () => {
  const { file, group } = fixture();
  expect(() => updateGroup(file, (g) => ({ ...g, files: ["../a", "group.json"] }))).toThrow();
  expect(() =>
    createGroup(join(file, "..", "new.json"), { ...group, files: ["../a", "group.json"] }),
  ).toThrow();
});
it("rejects a busy group instead of overwriting another writer", () => {
  const { file } = fixture();
  writeFileSync(file + ".lock", "another writer");
  expect(() => confirm(file)).toThrow();
  expect(readFileSync(file + ".lock", "utf8")).toBe("another writer");
});
it("preflights all explicitly selected groups before batch confirmation", () => {
  const { root, file, group } = fixture();
  const other = join(root, ".crosslink", "other.json");
  writeFileSync(other, JSON.stringify({ version: 1, ...group, name: "other" }));
  const before = readFileSync(file, "utf8");
  expect(() =>
    confirmGroups(
      [file, other],
      new Map([
        [file, inspectGroup(file).snapshot!],
        [other, "stale"],
      ]),
    ),
  ).toThrow();
  expect(readFileSync(file, "utf8")).toBe(before);
});
it("reproduces confirmation in a fresh copy without Git state", () => {
  const { root, file } = fixture();
  confirm(file);
  const copy = mkdtempSync(join(tmpdir(), "crosslink-copy-"));
  roots.push(copy);
  cpSync(root, copy, { recursive: true });
  expect(inspectGroup(join(copy, ".crosslink", "group.json")).status).toBe("confirmed");
});

it("detects changes from every member of a three-file group", () => {
  const { root, file } = fixture();
  writeFileSync(join(root, "c"), "c");
  updateGroup(file, (group) => ({ ...group, files: ["../a", "../b", "../c"] }));
  confirm(file);
  for (const name of ["a", "b", "c"]) {
    writeFileSync(join(root, name), "changed");
    expect(inspectGroup(file).status).toBe("unconfirmed");
    writeFileSync(join(root, name), name);
    expect(inspectGroup(file).status).toBe("confirmed");
  }
});

it("does not automatically confirm even when every related file was edited", () => {
  const { root, file } = fixture();
  confirm(file);
  const before = readFileSync(file, "utf8");
  writeFileSync(join(root, "a"), "new a");
  writeFileSync(join(root, "b"), "new b");
  expect(inspectGroup(file).status).toBe("unconfirmed");
  expect(readFileSync(file, "utf8")).toBe(before);
});
