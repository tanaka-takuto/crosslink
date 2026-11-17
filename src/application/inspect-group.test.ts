import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectGroup as inspect } from "./inspect-group.js";
import { filesystemPorts } from "../infrastructure/filesystem/adapter.js";
import { defaults } from "../infrastructure/filesystem/settings.js";
const inspectGroup = (file: string) => inspect(file, filesystemPorts, defaults);

const roots: string[] = [];

function fixture(files: string[] = ["../a", "../b"]) {
  const root = mkdtempSync(join(tmpdir(), "crosslink-test-"));
  roots.push(root);
  mkdirSync(join(root, ".crosslink"));
  writeFileSync(join(root, "a"), "a");
  writeFileSync(join(root, "b"), Buffer.from([0, 255, 128]));
  const file = join(root, ".crosslink", "test.json");
  writeFileSync(
    file,
    JSON.stringify({ version: 1, name: "test", reason: "一緒に確認するため", files }),
  );
  return { root, file };
}

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("inspection", () => {
  it("new groups are unconfirmed and expose every file, including binary files", () => {
    const { file } = fixture();
    const result = inspectGroup(file);
    expect(result.status).toBe("unconfirmed");
    expect(result.errors).toEqual([]);
    expect(result.files).toHaveLength(2);
    expect(result.snapshot).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([{ files: [] }, { files: ["../a"] }])(
    "allows saving a draft with $files, but reports an invalid group",
    ({ files }) => {
      const { file } = fixture(files);
      expect(inspectGroup(file).errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "TOO_FEW_FILES" })]),
      );
    },
  );

  it("diagnoses missing files without marking the group confirmed", () => {
    const { file } = fixture(["../a", "../missing"]);
    const before = readFileSync(file, "utf8");
    const result = inspectGroup(file);
    expect(result.errors).toEqual([
      {
        code: "FILE_UNREADABLE",
        message: expect.stringContaining("../missing"),
      },
    ]);
    expect(result.errors[0]!.message).toContain("read permissions");
    expect(result.errors[0]!.message).toContain("restore the file");
    expect(result.errors[0]!.message).toContain("update its registered path if moved");
    expect(result.errors[0]!.message).toContain(
      "remove it from the group if deletion was intended",
    );
    expect(result.status).toBe("unconfirmed");
    expect(result.snapshot).toBeNull();
    expect(result).not.toHaveProperty("definitionVerified");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("guides permission failures without guessing that the file was deleted", () => {
    const { root, file } = fixture();
    const before = readFileSync(file, "utf8");
    const ports = {
      ...filesystemPorts,
      files: {
        ...filesystemPorts.files,
        hash: () => {
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        },
      },
    };
    const result = inspect(file, ports, defaults);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toEqual({
      code: "FILE_UNREADABLE",
      message: expect.stringContaining("read permissions"),
    });
    expect(result.errors[0]!.message).toContain("../a");
    expect(result.errors[0]!.message).toContain("if deletion was intended");
    expect(result.snapshot).toBeNull();
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(readFileSync(join(root, "a"), "utf8")).toBe("a");
  });

  it("rejects a confirmation file as a member", () => {
    const { file } = fixture(["../a", "test.json"]);
    expect(inspectGroup(file).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MANAGEMENT_FILE" })]),
    );
  });

  it("reports malformed definitions", () => {
    const { file } = fixture();
    writeFileSync(file, "{");
    expect(inspectGroup(file).errors.length).toBeGreaterThan(0);
    expect(inspectGroup(file).status).toBe("unconfirmed");
    expect(inspectGroup(file).definitionVerified).toBe(false);
  });
});

it("expands overlapping globs into unique members and reports added/removed paths", () => {
  const { root, file } = fixture();
  const group = {
    version: 2,
    name: "test",
    reason: "ADR",
    files: ["../a"],
    globs: ["../*", "../b"],
  };
  writeFileSync(file, JSON.stringify(group));
  const initial = inspectGroup(file);
  expect(initial.errors).toEqual([]);
  expect(initial.files.map((f) => f.path)).toEqual(["../a", "../b"]);
  expect(initial.globs).toEqual(["../*", "../b"]);
  expect(initial.added).toBeNull();
  expect(initial.removed).toBeNull();
  const hashes = Object.fromEntries(initial.files.map((f) => [f.path, f.hash]));
  writeFileSync(
    file,
    JSON.stringify({
      ...group,
      confirmation: {
        definition: filesystemPorts.digest(
          JSON.stringify({
            name: group.name,
            reason: group.reason,
            files: group.files,
            globs: group.globs,
          }),
        ),
        hashes,
      },
    }),
  );
  writeFileSync(join(root, "c"), "b");
  const addition = inspectGroup(file);
  expect(addition.status).toBe("unconfirmed");
  expect(addition.added).toEqual(["../c"]);
  rmSync(join(root, "b"));
  // Keep each selector nonempty while testing a normal deletion.
  writeFileSync(
    file,
    JSON.stringify({
      ...group,
      globs: ["../*"],
      confirmation: { definition: "a".repeat(64), hashes },
    }),
  );
  const result = inspectGroup(file);
  expect(result.errors).toEqual([]);
  expect(result.files.map((f) => f.path)).toEqual(["../a", "../c"]);
  expect(result.removed?.map((f) => f.path)).toEqual(["../b"]);
});

it("rejects one zero-match glob even with two literal members", () => {
  const { file } = fixture();
  writeFileSync(
    file,
    JSON.stringify({
      version: 2,
      name: "test",
      reason: "ADR",
      files: ["../a", "../b"],
      globs: ["../missing*", "../a"],
    }),
  );
  expect(inspectGroup(file).errors).toEqual([expect.objectContaining({ code: "GLOB_NO_MATCH" })]);
  expect(inspectGroup(file).snapshot).toBeNull();
});

it("refuses membership changes during hashing instead of emitting a snapshot", () => {
  const { root, file } = fixture();
  writeFileSync(
    file,
    JSON.stringify({ version: 2, name: "test", reason: "ADR", files: [], globs: ["../*"] }),
  );
  const ports = {
    ...filesystemPorts,
    files: {
      ...filesystemPorts.files,
      hash: (target: string) => {
        const value = filesystemPorts.files.hash(target);
        writeFileSync(join(root, "new"), "same");
        return value;
      },
    },
  };
  expect(inspect(file, ports, defaults).errors).toContainEqual(
    expect.objectContaining({ code: "MEMBERS_CHANGED" }),
  );
});

it("keeps traversal failures incomplete rather than reporting old paths as removed", () => {
  const { file } = fixture();
  const group = {
    version: 2,
    name: "test",
    reason: "review",
    files: ["../a", "../b"],
    globs: ["../*"],
    confirmation: { definition: "a".repeat(64), hashes: { "../old": "b".repeat(64) } },
  };
  writeFileSync(file, JSON.stringify(group));
  const before = readFileSync(file, "utf8");
  const ports = {
    ...filesystemPorts,
    files: {
      ...filesystemPorts.files,
      expandGlob: () => {
        throw Object.assign(new Error("EIO: cannot enumerate"), { code: "EIO" });
      },
    },
  };
  const result = inspect(file, ports, defaults);
  expect(result.errors).toHaveLength(1);
  expect(result.membershipComplete).toBe(false);
  expect(result.removed).toBeNull();
  expect(result.added).toBeNull();
  expect(result.snapshot).toBeNull();
  expect(readFileSync(file, "utf8")).toBe(before);
});

it("reports a member disappearing after enumeration as unreadable, without removed inference", () => {
  const { root, file } = fixture();
  writeFileSync(
    file,
    JSON.stringify({ version: 2, name: "test", reason: "review", files: [], globs: ["../[ab]"] }),
  );
  const ports = {
    ...filesystemPorts,
    files: {
      ...filesystemPorts.files,
      hash: (target: string) => {
        if (target.endsWith("a")) rmSync(join(root, "a"), { force: true });
        return filesystemPorts.files.hash(target);
      },
    },
  };
  const result = inspect(file, ports, defaults);
  expect(result.errors.map((e) => e.code)).toContain("FILE_UNREADABLE");
  expect(result.snapshot).toBeNull();
  expect(result.files.find((f) => f.path === "../a")?.hash).toBeNull();
});

it("rejects a file symlink retargeted to another member during inspection even with identical bytes", () => {
  const { root, file } = fixture();
  writeFileSync(join(root, "a"), "same");
  writeFileSync(join(root, "b"), "same");
  symlinkSync(join(root, "a"), join(root, "link"));
  writeFileSync(
    file,
    JSON.stringify({
      version: 2,
      name: "test",
      reason: "review",
      files: [],
      globs: ["../b", "../link"],
    }),
  );
  let reads = 0;
  const ports = {
    ...filesystemPorts,
    files: {
      ...filesystemPorts.files,
      hash: (target: string) => {
        const value = filesystemPorts.files.hash(target);
        if (++reads === 2) {
          rmSync(join(root, "link"));
          symlinkSync(join(root, "b"), join(root, "link"));
        }
        return value;
      },
    },
  };
  expect(inspect(file, ports, defaults).errors.map((e) => e.code)).toContain("FILE_CHANGED");
});

it("does not expose an earlier hash as current when the final content recheck becomes unreadable", () => {
  const { file } = fixture();
  writeFileSync(
    file,
    JSON.stringify({ version: 2, name: "test", reason: "review", files: [], globs: ["../[ab]"] }),
  );
  let reads = 0;
  const ports = {
    ...filesystemPorts,
    files: {
      ...filesystemPorts.files,
      hash: (target: string) => {
        if (++reads === 3)
          throw Object.assign(new Error("permission denied on recheck"), { code: "EACCES" });
        return filesystemPorts.files.hash(target);
      },
    },
  };
  const result = inspect(file, ports, defaults);
  expect(result.errors.map((error) => error.code)).toContain("FILE_UNREADABLE");
  expect(result.files.find((member) => member.path === "../a")?.hash).toBeNull();
  expect(result.snapshot).toBeNull();
  expect(result).not.toHaveProperty("definitionVerified");
});

it("invalidates membership comparison when the final readable definition differs", () => {
  const { root, file } = fixture();
  writeFileSync(
    file,
    JSON.stringify({
      version: 2,
      name: "test",
      reason: "review",
      files: [],
      globs: ["../[ab]"],
      confirmation: { definition: "a".repeat(64), hashes: { "../old": "b".repeat(64) } },
    }),
  );
  let changed = false;
  const result = inspect(
    file,
    {
      ...filesystemPorts,
      files: {
        ...filesystemPorts.files,
        hash: (target) => {
          const value = filesystemPorts.files.hash(target);
          if (!changed) {
            changed = true;
            const definition = JSON.parse(readFileSync(file, "utf8"));
            definition.reason = "changed reason";
            writeFileSync(file, JSON.stringify(definition));
          }
          return value;
        },
      },
    },
    defaults,
  );
  expect(result.errors.map((error) => error.code)).toEqual(["GROUP_CHANGED"]);
  expect(result.definitionVerified).toBe(false);
  expect(result.membershipComplete).toBe(true);
  expect(result.added).toBeNull();
  expect(result.removed).toBeNull();
  expect(result.snapshot).toBeNull();
  expect(readFileSync(join(root, "a"), "utf8")).toBe("a");
});
