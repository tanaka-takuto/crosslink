import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectGroup as inspect } from "./inspect-group.js";
import { filesystemPorts } from "../infrastructure/filesystem/adapter.js";
import { defaults } from "../infrastructure/filesystem/settings.js";
import { canonicalDefinition } from "../domain/group.js";
const inspectGroup = (file: string) => inspect(file, filesystemPorts, defaults);

// 元の組込みFSへforwardし、実際の判定に使った同じ返値だけを記録する。
vi.mock("node:fs", async (original) => ({ ...(await original<typeof import("node:fs")>()) }));

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

describe.each([
  { format: "legacy v1", fields: { version: 1 } },
  { format: "v2 without globs", fields: { kind: "crosslink-group", version: 2 } },
  { format: "v2 empty globs", fields: { version: 2, globs: [] } },
  { format: "v3 default both", fields: { version: 3, roles: { files: {}, globs: {} } } },
])("static inspection: $format", ({ fields }) => {
  function staticFixture(confirmed: boolean) {
    const { root, file } = fixture();
    const group = { ...JSON.parse(readFileSync(file, "utf8")), ...fields };
    writeFileSync(file, JSON.stringify(group));
    if (confirmed) {
      const initial = inspectGroup(file);
      expect(initial.errors).toEqual([]);
      group.confirmation = {
        definition: filesystemPorts.digest(canonicalDefinition(group)),
        hashes: Object.fromEntries(initial.files.map((entry) => [entry.path, entry.hash])),
        ...("roles" in fields
          ? { roles: Object.fromEntries(initial.files.map((entry) => [entry.path, entry.role])) }
          : {}),
      };
      writeFileSync(file, JSON.stringify(group));
    }
    return { root, file };
  }

  it("preserves stable initial, confirmed and unconfirmed results and legacy snapshot shape", () => {
    const { root, file } = staticFixture(false);
    const initialBytes = readFileSync(file, "utf8");
    const initial = inspectGroup(file);
    expect(initial.errors).toEqual([]);
    expect(initial.status).toBe("unconfirmed");
    expect(initial.files.every((entry) => entry.changed === null)).toBe(true);
    expect(inspectGroup(file)).toEqual(initial);
    expect(readFileSync(file, "utf8")).toBe(initialBytes);
    if (!("roles" in fields)) {
      expect(Object.keys(initial).sort()).toEqual(
        ["file", "name", "reason", "status", "files", "snapshot", "errors"].sort(),
      );
      expect(initial.snapshot).toBe(
        filesystemPorts.digest(
          JSON.stringify({
            file,
            raw: initialBytes,
            files: initial.files.map((entry) => [entry.path, entry.hash]),
          }),
        ),
      );
    }
    const group = filesystemPorts.groups.read(file).group;
    writeFileSync(
      file,
      JSON.stringify({
        ...JSON.parse(initialBytes),
        confirmation: {
          definition: filesystemPorts.digest(canonicalDefinition(group)),
          hashes: Object.fromEntries(initial.files.map((entry) => [entry.path, entry.hash])),
          ...(group.roles
            ? { roles: Object.fromEntries(initial.files.map((entry) => [entry.path, entry.role])) }
            : {}),
        },
      }),
    );
    const confirmedBytes = readFileSync(file, "utf8");
    expect(inspectGroup(file).status).toBe("confirmed");
    writeFileSync(join(root, "a"), "changed");
    const changed = inspectGroup(file);
    expect(changed.errors).toEqual([]);
    expect(changed.status).toBe("unconfirmed");
    expect(changed.snapshot).toMatch(/^[a-f0-9]{64}$/);
    expect(changed.files[0]!.changed).toBe(true);
    writeFileSync(join(root, "a"), "a");
    expect(inspectGroup(file).status).toBe("confirmed");
    expect(readFileSync(file, "utf8")).toBe(confirmedBytes);
  });

  describe.each([false, true])("baseline confirmed=%s", (confirmed) => {
    it.each(["content", "unreadable", "symlink"] as const)(
      "rejects an earlier member's %s change observed after reading the next member",
      (change) => {
        const { root, file } = staticFixture(confirmed);
        const a = join(root, "a"),
          b = join(root, "b");
        if (change === "symlink") {
          writeFileSync(join(root, "first"), "a");
          writeFileSync(join(root, "second"), "a");
          rmSync(a);
          symlinkSync(join(root, "first"), a);
        }
        const before = readFileSync(file);
        const bBefore = readFileSync(b);
        const bHash = filesystemPorts.files.hash(b).hash;
        let changed = false;
        const ports = {
          ...filesystemPorts,
          files: {
            ...filesystemPorts.files,
            hash: (target: string) => {
              const value = filesystemPorts.files.hash(target);
              // 実adapterの通常読取を通し、後続Bの読取時に先行Aだけを変更する。
              if (target === b && !changed) {
                changed = true;
                if (change === "content") writeFileSync(a, "changed");
                else {
                  rmSync(a);
                  if (change === "symlink") symlinkSync(join(root, "second"), a);
                }
              }
              return value;
            },
          },
        };
        const result = inspect(file, ports, defaults);
        expect(changed).toBe(true);
        expect(result.errors.map((error) => error.code)).toEqual([
          change === "unreadable" ? "FILE_UNREADABLE" : "FILE_CHANGED",
        ]);
        expect(result.status).toBe("unconfirmed");
        expect(result.snapshot).toBeNull();
        expect(result.files[0]).toMatchObject({
          path: "../a",
          hash: null,
          changed: confirmed ? true : null,
        });
        expect(result.files[1]!.hash).toBe(bHash);
        expect(readFileSync(file)).toEqual(before);
        expect(readFileSync(b)).toEqual(bBefore);
      },
    );
  });
});

describe("inspection", () => {
  it("new groups are unconfirmed and expose every file, including binary files", () => {
    const { file } = fixture();
    const events: object[] = [],
      decisions: object[] = [],
      limit = 64;
    let active: number | null = null,
      total = 0;
    const trace = <T>(
      operation: string,
      target: string,
      call: () => T,
      details: (result: T) => unknown,
    ) => {
      const record = (event: object) => {
        if (active === null) return;
        total++;
        if (events.length < limit)
          events.push({
            ordinal: total,
            decision: active,
            operation,
            target,
            normalized: resolve(target),
            ...event,
          });
      };
      try {
        const result = call();
        record({ outcome: "ok", result: details(result) });
        return result;
      } catch (error) {
        record({
          outcome: "throw",
          code: (error as NodeJS.ErrnoException).code ?? null,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };
    const realStat = fs.statSync,
      realNative = fs.realpathSync.native;
    const stat = vi.spyOn(fs, "statSync").mockImplementation((target, options) =>
      trace(
        "stat",
        String(target),
        () => realStat(target, options),
        (value) =>
          value
            ? {
                bigint: typeof value.dev === "bigint",
                dev: value.dev.toString(),
                ino: value.ino.toString(),
              }
            : null,
      ),
    );
    const native = vi.spyOn(fs.realpathSync, "native").mockImplementation((target, options) =>
      trace(
        "realpath.native",
        String(target),
        () => realNative(target, options),
        (value) => value.toString(),
      ),
    );
    const ports = {
      ...filesystemPorts,
      files: {
        ...filesystemPorts.files,
        isManagementFile: (...args: Parameters<typeof filesystemPorts.files.isManagementFile>) => {
          const decision = {
            ordinal: decisions.length + 1,
            member: args[0],
            management: args[1],
            result: null as boolean | null,
          };
          decisions.push(decision);
          active = decision.ordinal;
          try {
            const result = filesystemPorts.files.isManagementFile(...args);
            decision.result = result;
            return result;
          } finally {
            active = null;
          }
        },
      },
    };
    let result: ReturnType<typeof inspect>;
    try {
      result = inspect(file, ports, defaults);
    } finally {
      stat.mockRestore();
      native.mockRestore();
    }
    const diagnostic = JSON.stringify({
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      decisions,
      events: { entries: events, total, limit, truncated: total > limit },
      inspection: result,
    });
    expect(result.status, diagnostic).toBe("unconfirmed");
    expect(result.errors, diagnostic).toEqual([]);
    expect(result.files, diagnostic).toHaveLength(2);
    expect(result.snapshot, diagnostic).toMatch(/^[a-f0-9]{64}$/);
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

describe("directional inspection", () => {
  function directional(dynamic = false) {
    const { root, file } = fixture();
    mkdirSync(join(root, "source"));
    mkdirSync(join(root, "target"));
    writeFileSync(join(root, "source", "a"), "source");
    writeFileSync(join(root, "target", "b"), "target");
    writeFileSync(
      file,
      JSON.stringify({
        version: 3,
        name: "directional",
        reason: "source impact",
        files: dynamic ? [] : ["../source/a", "../target/b"],
        ...(dynamic ? { globs: ["../source/*", "../target/*"] } : {}),
        roles: {
          files: dynamic ? {} : { "../source/a": "source-only", "../target/b": "target-only" },
          globs: dynamic ? { "../source/*": "source-only", "../target/*": "target-only" } : {},
        },
      }),
    );
    return { root, file };
  }
  function record(file: string) {
    const current = inspectGroup(file);
    expect(current.errors).toEqual([]);
    const group = filesystemPorts.groups.read(file).group;
    group.confirmation = {
      definition: filesystemPorts.digest(canonicalDefinition(group)),
      hashes: Object.fromEntries(current.files.map((f) => [f.path, f.hash!])),
      roles: Object.fromEntries(current.files.map((f) => [f.path, f.role!])),
    };
    filesystemPorts.groups.write(file, group);
  }
  it.each([false, true])(
    "keeps target-only changes confirmed and exposes source changes and review targets (glob=%s)",
    (dynamic) => {
      const { root, file } = directional(dynamic);
      expect(inspectGroup(file).status).toBe("unconfirmed");
      record(file);
      writeFileSync(join(root, "target/b"), "changed");
      const target = inspectGroup(file);
      expect(target.status).toBe("confirmed");
      expect(target.files[1]!.changed).toBe(true);
      expect(target.reviewTargets).toEqual(["../target/b"]);
      expect(target.sourceChanges).toEqual([]);
      writeFileSync(join(root, "source/a"), "changed");
      expect(inspectGroup(file).sourceChanges).toEqual(["../source/a"]);
      expect(inspectGroup(file).status).toBe("unconfirmed");
      writeFileSync(join(root, "source/a"), "source");
      expect(inspectGroup(file).status).toBe("confirmed");
    },
  );
  it.each(["source", "target"])(
    "compares %s glob additions, removals and same-content rename",
    (side) => {
      const { root, file } = directional(true);
      record(file);
      writeFileSync(join(root, side, "extra"), side);
      expect(inspectGroup(file).status).toBe(side === "source" ? "unconfirmed" : "confirmed");
      rmSync(join(root, side, "extra"));
      expect(inspectGroup(file).status).toBe("confirmed");
      renameSync(join(root, side, side === "source" ? "a" : "b"), join(root, side, "renamed"));
      const renamed = inspectGroup(file);
      expect(renamed.status).toBe(side === "source" ? "unconfirmed" : "confirmed");
      expect(renamed.removed?.[0]?.role).toBe(side === "source" ? "source-only" : "target-only");
      rmSync(join(root, side, "renamed"));
      expect(inspectGroup(file).errors.some((e) => e.code === "GLOB_NO_MATCH")).toBe(true);
    },
  );
  it("merges selector overlaps into one effective both without permitting physical aliases", () => {
    const { root, file } = directional(true);
    const group = filesystemPorts.groups.read(file).group;
    group.files = ["../source/a"];
    group.roles!.files = { "../source/a": "target-only" };
    filesystemPorts.groups.write(file, group);
    const current = inspectGroup(file);
    expect(current.errors).toEqual([]);
    expect(current.files).toHaveLength(2);
    expect(current.files[0]!.role).toBe("both");
    symlinkSync(join(root, "source/a"), join(root, "target/alias"));
    expect(inspectGroup(file).errors.some((e) => e.code === "DUPLICATE_MEMBER")).toBe(true);
  });
  it.each(["source-only", "target-only"])(
    "allows saving a %s draft but rejects missing effective side",
    (role) => {
      const { file } = directional();
      const group = filesystemPorts.groups.read(file).group;
      group.roles!.files = Object.fromEntries(
        group.files.map((path) => [path, role as "source-only" | "target-only"]),
      );
      filesystemPorts.groups.write(file, group);
      expect(inspectGroup(file).errors.some((e) => e.code === "MISSING_ROLE")).toBe(true);
      expect(inspectGroup(file).snapshot).toBeNull();
    },
  );
  it.for(
    [false, true].flatMap((reverse) =>
      [false, true].flatMap((baseline) =>
        ["source/a", "target/b"].map((path) => ({ reverse, baseline, path })),
      ),
    ),
  )(
    "rejects static v3 $path content races (reverse=$reverse, baseline=$baseline)",
    ({ path, reverse, baseline }) => {
      const { root, file } = directional();
      if (reverse) {
        const group = filesystemPorts.groups.read(file).group;
        group.roles!.files = { "../source/a": "target-only", "../target/b": "source-only" };
        filesystemPorts.groups.write(file, group);
      }
      if (baseline) record(file);
      let count = 0;
      const ports = {
        ...filesystemPorts,
        files: {
          ...filesystemPorts.files,
          hash: (p: string) => {
            const value = filesystemPorts.files.hash(p);
            if (++count === 2) writeFileSync(join(root, path), "racing");
            return value;
          },
        },
      };
      const current = inspect(file, ports, defaults);
      expect(current.errors.some((e) => e.code === "FILE_CHANGED")).toBe(true);
      expect(current.snapshot).toBeNull();
      expect(current.sourceChanges).toBeNull();
    },
  );
  it("never skips target read failures or definition final revalidation", () => {
    const { root, file } = directional();
    rmSync(join(root, "target/b"));
    expect(inspectGroup(file).errors.some((e) => e.code === "FILE_UNREADABLE")).toBe(true);
    writeFileSync(join(root, "target/b"), "restored");
    const ports = {
      ...filesystemPorts,
      groups: {
        ...filesystemPorts.groups,
        readRaw: () => {
          throw new Error("unavailable");
        },
      },
    };
    expect(inspect(file, ports, defaults)).toMatchObject({
      definitionVerified: false,
      snapshot: null,
      status: "unconfirmed",
      sourceChanges: null,
      reviewTargets: null,
    });
  });
});

it("rejects fixed lexical aliases even across source and target roles", () => {
  const { file } = fixture(["../a", ".././a", "../b"]);
  const group = filesystemPorts.groups.read(file).group;
  group.roles = { files: { "../a": "source-only", ".././a": "target-only" }, globs: {} };
  filesystemPorts.groups.write(file, group);
  expect(inspectGroup(file).errors.some((error) => error.code === "DUPLICATE_MEMBER")).toBe(true);
});
it("tracks source-role changes caused by overlapping dynamic membership", () => {
  const { root, file } = fixture([]);
  writeFileSync(
    file,
    JSON.stringify({
      version: 3,
      name: "overlap",
      reason: "dynamic roles",
      files: ["../a", "../b"],
      globs: ["../[a]*"],
      roles: { files: { "../a": "target-only" }, globs: { "../[a]*": "source-only" } },
    }),
  );
  const group = filesystemPorts.groups.read(file).group;
  const current = inspectGroup(file);
  group.confirmation = {
    definition: filesystemPorts.digest(canonicalDefinition(group)),
    hashes: Object.fromEntries(current.files.map((f) => [f.path, f.hash!])),
    roles: Object.fromEntries(current.files.map((f) => [f.path, f.role!])),
  };
  filesystemPorts.groups.write(file, group);
  // globがaを外しa-extraを追加する。固定targetのaは残るがsourceから外れる。
  writeFileSync(join(root, "a-extra"), "a");
  const ports = {
    ...filesystemPorts,
    files: { ...filesystemPorts.files, expandGlob: () => ["../a-extra"] },
  };
  const result = inspect(file, ports, defaults);
  expect(result.status).toBe("unconfirmed");
  expect(result.sourceChanges).toEqual(["../a", "../a-extra"]);
});

it("treats prototype-named selectors as ordinary paths with default both roles", () => {
  const { root, file } = fixture(["__proto__", "constructor"]);
  writeFileSync(join(root, ".crosslink/__proto__"), "a");
  writeFileSync(join(root, ".crosslink/constructor"), "b");
  const group = filesystemPorts.groups.read(file).group;
  group.roles = { files: {}, globs: {} };
  filesystemPorts.groups.write(file, group);
  expect(inspectGroup(file).files.map((f) => f.role)).toEqual(["both", "both"]);
});
