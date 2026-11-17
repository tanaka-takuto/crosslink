import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { digest, hashFile } from "./content-hash.js";

vi.mock("node:fs", async (original) => ({ ...(await original<typeof import("node:fs")>()) }));

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
    expect.objectContaining({
      code: "NOT_A_FILE",
      message: expect.stringContaining("Update the registered path to a regular file"),
    }),
  );
  expect(() => hashFile(join(root, "missing"))).toThrow();
});

it("uses one physical identity for existing native path aliases", () => {
  const root = fixture(),
    file = join(root, "café"),
    alias = join(root, "cafe\u0301");
  writeFileSync(file, "same file");
  if (existsSync(alias)) expect(hashFile(alias).identity).toBe(hashFile(file).identity);
  else expect(() => hashFile(alias)).toThrow();
});

it.each(["dev", "ino"] as const)(
  "rejects a changed %s even when Number rounds both IDs alike",
  (field) => {
    const file = join(fixture(), "data");
    writeFileSync(file, "same");
    const first = 2n ** 53n,
      second = first + 1n;
    expect(Number(first)).toBe(Number(second));
    const realStat = fs.statSync,
      realFstat = fs.fstatSync;
    const stat = vi.spyOn(fs, "statSync").mockImplementation((target, options) =>
      Object.assign(realStat(target, options)!, {
        [field]: options?.bigint ? second : Number(second),
      }),
    );
    const fstat = vi.spyOn(fs, "fstatSync").mockImplementation((fd, options) =>
      Object.assign(realFstat(fd, options), {
        [field]: options?.bigint ? first : Number(first),
      }),
    );
    try {
      expect(() => hashFile(file)).toThrow(expect.objectContaining({ code: "FILE_CHANGED" }));
    } finally {
      stat.mockRestore();
      fstat.mockRestore();
    }
  },
);

it.each([
  { field: "mtime", phase: "descriptor" },
  { field: "ctime", phase: "descriptor" },
  { field: "mtime", phase: "path" },
  { field: "ctime", phase: "path" },
] as const)(
  "rejects a one-nanosecond $field change during the $phase recheck",
  ({ field, phase }) => {
    const file = join(fixture(), "data");
    writeFileSync(file, "same");
    const before = 1_700_000_000_000_000_000n,
      after = before + 1n;
    expect(Number(before) / 1e6).toBe(Number(after) / 1e6);
    expect(before / 1_000_000n).toBe(after / 1_000_000n);
    const state = <T extends fs.Stats | fs.BigIntStats>(
      value: T,
      ns: bigint,
      bigint: boolean | undefined,
    ) =>
      Object.assign(value, {
        [field + "Ms"]: bigint ? ns / 1_000_000n : Number(ns) / 1e6,
        [field + "Ns"]: ns,
      });
    let reads = 0;
    const realStat = fs.statSync,
      realFstat = fs.fstatSync;
    const stat = vi
      .spyOn(fs, "statSync")
      .mockImplementation((target, options) =>
        state(realStat(target, options)!, after, options?.bigint),
      );
    const fstat = vi
      .spyOn(fs, "fstatSync")
      .mockImplementation((fd, options) =>
        state(
          realFstat(fd, options),
          ++reads === 1 || phase === "path" ? before : after,
          options?.bigint,
        ),
      );
    try {
      expect(() => hashFile(file)).toThrow(expect.objectContaining({ code: "FILE_CHANGED" }));
    } finally {
      stat.mockRestore();
      fstat.mockRestore();
    }
  },
);

it("keeps native realpaths as public identities for distinct hardlink paths", () => {
  const root = fixture(),
    first = join(root, "first"),
    second = join(root, "second");
  writeFileSync(first, "same");
  linkSync(first, second);
  expect(hashFile(first).hash).toBe(hashFile(second).hash);
  expect(hashFile(first).identity).toBe(fs.realpathSync.native(first));
  expect(hashFile(second).identity).toBe(fs.realpathSync.native(second));
  expect(hashFile(first).identity).not.toBe(hashFile(second).identity);
});
