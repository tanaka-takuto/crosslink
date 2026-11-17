import {
  cpSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

it.each(["add", "delete", "rename", "content", "definition"])(
  "rejects a stale dynamic snapshot after %s without updating records",
  (change) => {
    const { root, file } = fixture();
    writeFileSync(join(root, "c"), "c");
    updateGroup(file, (group) => ({ ...group, files: [], globs: ["../[abc]*"] }));
    confirm(file);
    const snapshot = inspectGroup(file).snapshot!;
    if (change === "add") writeFileSync(join(root, "added"), "a");
    if (change === "delete") rmSync(join(root, "c"));
    if (change === "rename") renameSync(join(root, "c"), join(root, "copy"));
    if (change === "content") writeFileSync(join(root, "b"), "new");
    if (change === "definition")
      writeFileSync(file, readFileSync(file, "utf8").replace("一緒に確認", "new reason"));
    const before = readFileSync(file, "utf8");
    expect(() => confirmGroups([file], new Map([[file, snapshot]]))).toThrow(
      expect.objectContaining({ code: "STALE_SNAPSHOT" }),
    );
    expect(readFileSync(file, "utf8")).toBe(before);
  },
);

it.each([0, 1])("saves %i expanded files but refuses inspection and confirmation", (count) => {
  const { root, file } = fixture();
  const globs = count ? ["../a"] : ["../none*"];
  updateGroup(file, (group) => ({ ...group, files: [], globs }));
  const checked = inspectGroup(file);
  expect(checked.files).toHaveLength(count);
  expect(checked.errors.map((e) => e.code)).toContain("TOO_FEW_FILES");
  expect(checked.snapshot).toBeNull();
  const before = readFileSync(file, "utf8");
  expect(() => confirm(file)).toThrow(expect.objectContaining({ code: "INVALID_GROUP" }));
  expect(readFileSync(file, "utf8")).toBe(before);
  expect(readFileSync(join(root, "a"), "utf8")).toBe("a");
});

it("deduplicates overlapping selector paths, rejects symlink aliases and preserves hardlink compatibility", () => {
  const { root, file } = fixture();
  updateGroup(file, (group) => ({ ...group, globs: ["../a", "../[ab]", "../[ab]"] }));
  expect(inspectGroup(file).files).toHaveLength(2);
  expect(inspectGroup(file).errors).toEqual([]);
  symlinkSync(join(root, "a"), join(root, "alias"));
  expect(inspectGroup(file).errors).toEqual([]);
  updateGroup(file, (group) => ({ ...group, globs: ["../a*"] }));
  expect(inspectGroup(file).errors.map((e) => e.code)).toContain("DUPLICATE_MEMBER");
  rmSync(join(root, "alias"));
  linkSync(join(root, "a"), join(root, "alias"));
  expect(inspectGroup(file).errors).toEqual([]);
});

it("rejects management records selected by globs including kind declarations and aliases", () => {
  const { root, file } = fixture();
  updateGroup(file, (group) => ({ ...group, globs: ["*.json"] }));
  expect(inspectGroup(file).errors.map((e) => e.code)).toContain("MANAGEMENT_FILE");
  writeFileSync(
    join(root, "declared.record"),
    JSON.stringify({
      kind: "crosslink-group",
      version: 2,
      name: "other",
      reason: "review",
      files: [],
      globs: ["a"],
    }),
  );
  updateGroup(file, (group) => ({ ...group, globs: ["../*.record"] }));
  expect(inspectGroup(file).errors.map((e) => e.code)).toContain("MANAGEMENT_FILE");
  symlinkSync(file, join(root, "alias.record"));
  expect(inspectGroup(file).errors.filter((e) => e.code === "MANAGEMENT_FILE")).toHaveLength(2);
});

it.skipIf(process.platform === "win32")(
  "keeps metacharacters in literal file names without glob expansion",
  () => {
    const { root, file } = fixture();
    const literal = "literal*?[x]{}";
    writeFileSync(join(root, literal), "literal");
    updateGroup(file, (group) => ({ ...group, files: ["../a", "../" + literal], globs: ["../b"] }));
    expect(inspectGroup(file).errors).toEqual([]);
    expect(inspectGroup(file).files.map((f) => f.path)).toContain("../" + literal);
  },
);

it("detects a previously hashed file changing during a dynamic inspection", () => {
  const { root, file } = fixture();
  updateGroup(file, (group) => ({ ...group, files: [], globs: ["../[ab]"] }));
  let reads = 0;
  const ports = {
    ...filesystemPorts,
    files: {
      ...filesystemPorts.files,
      hash: (target: string) => {
        const result = filesystemPorts.files.hash(target);
        if (++reads === 2) writeFileSync(join(root, "a"), "changed during later hash");
        return result;
      },
    },
  };
  expect(inspect(file, ports, defaults).errors.map((e) => e.code)).toContain("FILE_CHANGED");
});

it("revalidates every prepared group before batch writes when a later inspection changes an earlier set", () => {
  const { root, file } = fixture();
  writeFileSync(join(root, "c"), "c");
  updateGroup(file, (group) => ({ ...group, files: ["../b"], globs: ["../a*"] }));
  const second = join(root, ".crosslink/z-second.json");
  createGroup(second, { name: "second", reason: "review", files: ["../c"], globs: ["../b*"] });
  const expected = new Map(
    [file, second].map((target) => [target, inspectGroup(target).snapshot!]),
  );
  const before = [file, second].map((target) => readFileSync(target, "utf8"));
  let inSecond = false,
    writes = 0;
  const ports = {
    ...filesystemPorts,
    groups: {
      ...filesystemPorts.groups,
      read: (target: string) => {
        if (target === second) inSecond = true;
        return filesystemPorts.groups.read(target);
      },
      write: () => {
        writes++;
      },
    },
    files: {
      ...filesystemPorts.files,
      hash: (target: string) => {
        const result = filesystemPorts.files.hash(target);
        if (inSecond) writeFileSync(join(root, "added"), "same");
        return result;
      },
    },
  };
  expect(() => operations.confirmGroups([file, second], expected, ports, defaults)).toThrow(
    expect.objectContaining({ code: "STALE_SNAPSHOT" }),
  );
  expect(writes).toBe(0);
  expect([file, second].map((target) => readFileSync(target, "utf8"))).toEqual(before);
});

it("refuses confirmation when the last match disappears even with two fixed files", () => {
  const { root, file } = fixture();
  writeFileSync(join(root, "c"), "c");
  updateGroup(file, (group) => ({ ...group, globs: ["../c"] }));
  confirm(file);
  rmSync(join(root, "c"));
  const before = readFileSync(file, "utf8");
  const result = inspectGroup(file);
  expect(result.errors.map((error) => error.code)).toContain("GLOB_NO_MATCH");
  expect(result.removed?.map((member) => member.path)).toEqual(["../c"]);
  expect(() => confirm(file)).toThrow(expect.objectContaining({ code: "INVALID_GROUP" }));
  expect(readFileSync(file, "utf8")).toBe(before);
});

it.each(["a", "b"])(
  "rejects stale directional %s snapshot with zero writes to every selected group",
  (changed) => {
    const { root, file, group } = fixture();
    const direction: Group = {
      ...group,
      roles: { files: { "../a": "source-only", "../b": "target-only" }, globs: {} },
    };
    filesystemPorts.groups.write(file, direction);
    confirm(file);
    const other = join(root, ".crosslink/other.json");
    createGroup(other, { ...group, name: "other" });
    const files = [file, other];
    const expected = new Map(files.map((f) => [f, inspectGroup(f).snapshot!]));
    writeFileSync(join(root, changed), "changed");
    const writes: string[] = [];
    const ports = {
      ...filesystemPorts,
      groups: {
        ...filesystemPorts.groups,
        write: (f: string) => {
          writes.push(f);
        },
      },
    };
    expect(() => operations.confirmGroups(files, expected, ports, defaults)).toThrow(
      expect.objectContaining({ code: "STALE_SNAPSHOT" }),
    );
    expect(writes).toEqual([]);
    expect(inspectGroup(file).status).toBe(changed === "a" ? "unconfirmed" : "confirmed");
    expect(inspectGroup(other).status).toBe("unconfirmed");
  },
);

it.each(["both", "source-only", "target-only"] as const)(
  "binds all %s glob content and membership to confirmation snapshots",
  (role) => {
    for (const mutation of ["content", "add", "delete", "rename"] as const) {
      const { root, file, group } = fixture();
      mkdirSync(join(root, "members"));
      writeFileSync(join(root, "members/one"), "same");
      writeFileSync(join(root, "members/two"), "same");
      filesystemPorts.groups.write(file, {
        ...group,
        files: ["../a"],
        globs: ["../members/*"],
        roles: { files: {}, globs: role === "both" ? {} : { "../members/*": role } },
      });
      confirm(file);
      const expected = new Map([[file, inspectGroup(file).snapshot!]]),
        before = readFileSync(file, "utf8");
      if (mutation === "content") writeFileSync(join(root, "members/one"), "changed");
      if (mutation === "add") writeFileSync(join(root, "members/new"), "same");
      if (mutation === "delete") rmSync(join(root, "members/one"));
      if (mutation === "rename") renameSync(join(root, "members/one"), join(root, "members/new"));
      expect(inspectGroup(file).status, `${role}: ${mutation}`).toBe(
        role === "target-only" ? "confirmed" : "unconfirmed",
      );
      const writes: string[] = [];
      const ports = {
        ...filesystemPorts,
        groups: {
          ...filesystemPorts.groups,
          write: (f: string) => {
            writes.push(f);
          },
        },
      };
      expect(
        () => operations.confirmGroups([file], expected, ports, defaults),
        `${role}: ${mutation}`,
      ).toThrow(expect.objectContaining({ code: "STALE_SNAPSHOT" }));
      expect(writes).toEqual([]);
      expect(readFileSync(file, "utf8")).toBe(before);
    }
  },
);
it.each(["a", "b"])("revalidates an earlier directional %s before any batch write", (path) => {
  const { root, file, group } = fixture();
  filesystemPorts.groups.write(file, {
    ...group,
    roles: { files: { "../a": "source-only", "../b": "target-only" }, globs: {} },
  });
  for (const member of ["c", "d"]) writeFileSync(join(root, member), member);
  const later = join(root, ".crosslink/z.json");
  createGroup(later, { ...group, name: "later", files: ["../c", "../d"] });
  const expected = new Map([file, later].map((f) => [f, inspectGroup(f).snapshot!]));
  const writes: string[] = [];
  let changed = false;
  const ports = {
    ...filesystemPorts,
    groups: {
      ...filesystemPorts.groups,
      write: (f: string) => {
        writes.push(f);
      },
    },
    files: {
      ...filesystemPorts.files,
      hash: (f: string) => {
        if (!changed && f === join(root, "c")) {
          changed = true;
          writeFileSync(join(root, path), "changed during later inspection");
        }
        return filesystemPorts.files.hash(f);
      },
    },
  };
  expect(() => operations.confirmGroups([file, later], expected, ports, defaults)).toThrow(
    expect.objectContaining({ code: "STALE_SNAPSHOT" }),
  );
  expect(writes).toEqual([]);
});
