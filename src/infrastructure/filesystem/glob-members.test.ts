import { hashFile } from "./content-hash.js";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { expandGlob } from "./glob-members.js";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "crosslink-glob-[test]-"));
  roots.push(root);
  mkdirSync(join(root, "adr/nested"), { recursive: true });
  for (const file of ["adr/a.md", "adr/b.txt", "adr/nested/c.md", "adr/.hidden.md"])
    writeFileSync(join(root, file), file);
  return root;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it("uses Node glob syntax for star, globstar, question and character classes with deterministic paths", () => {
  const root = fixture();
  expect(expandGlob("adr/**/*.md", root)).toEqual(["adr/a.md", "adr/nested/c.md"]);
  expect(expandGlob("adr/?.[mt][dx]*", root)).toEqual(["adr/a.md", "adr/b.txt"]);
  expect(expandGlob("adr/.*.md", root)).toEqual(["adr/.hidden.md"]);
  expect(expandGlob("adr/*", root)).toEqual(["adr/a.md", "adr/b.txt"]);
  expect(expandGlob("missing/**/*.md", root)).toEqual([]);
});

it("supports absolute patterns and parent paths without interpreting metacharacters in cwd", () => {
  const root = fixture();
  const canonical = realpathSync(root);
  const escaped = canonical
    .replaceAll("\\", "/")
    .replace(/[[\]]/g, (c) => (c === "[" ? "[[]" : "[]]"));
  expect(
    expandGlob(escaped + "/adr/**/*.md", root),
    JSON.stringify({
      node: process.version,
      platform: process.platform,
      canonical,
      native: realpathSync.native(root),
    }),
  ).toEqual([
    join(canonical, "adr/a.md").replaceAll("\\", "/"),
    join(canonical, "adr/nested/c.md").replaceAll("\\", "/"),
  ]);
  expect(expandGlob("../adr/*.md", join(root, "adr"))).toEqual(["a.md"]);
});

it("matches existing native literal aliases without folding case or changing returned paths", () => {
  const root = fixture();
  mkdirSync(join(root, "café"));
  writeFileSync(join(root, "café/a.md"), "a");
  const alias = join(realpathSync(root), "cafe\u0301");
  const escaped = alias.replaceAll("\\", "/").replace(/[[\]]/g, (c) => (c === "[" ? "[[]" : "[]]"));
  // 正規化aliasの有無はFS依存。既存aliasならその表記を保持し、無ければ0一致。
  expect(expandGlob(escaped + "/*.md", root)).toEqual(
    existsSync(alias) ? [join(alias, "a.md").replaceAll("\\", "/")] : [],
  );
  expect(expandGlob("CAFE\u0301/*.md", root)).toEqual([]);
  expect(expandGlob("cafe\u0301/*.MD", root)).toEqual([]);
  symlinkSync(
    join(root, "adr"),
    join(root, "línk"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(expandGlob("li\u0301nk/*.md", root)).toEqual([]);
});

it("keeps regular file symlinks and skips directory symlinks including cycles and literal directory segments", () => {
  const root = fixture();
  symlinkSync(join(root, "adr/a.md"), join(root, "adr/alias.md"));
  symlinkSync(
    join(root, "adr"),
    join(root, "adr/loop"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(expandGlob("adr/**/*.md", root)).toEqual(["adr/a.md", "adr/alias.md", "adr/nested/c.md"]);
  expect(expandGlob("adr/loop/*.md", root)).toEqual([]);
});

it.skipIf(process.platform === "win32")(
  "surfaces traversal permission failures that native glob suppresses",
  () => {
    const root = fixture();
    chmodSync(join(root, "adr/nested"), 0);
    try {
      expect(() => expandGlob("adr/**/*.md", root)).toThrow(
        expect.objectContaining({ code: "GLOB_UNREADABLE" }),
      );
    } finally {
      chmodSync(join(root, "adr/nested"), 0o755);
    }
  },
);

it("reports a broken file symlink rather than silently succeeding", () => {
  const root = fixture();
  symlinkSync(join(root, "missing"), join(root, "adr/broken.md"));
  expect(() => expandGlob("adr/*.md", root)).toThrow(
    expect.objectContaining({ code: "GLOB_UNREADABLE" }),
  );
});

it("matches filename case identically on every OS instead of native macOS nocase", () => {
  const root = fixture();
  writeFileSync(join(root, "adr/UPPER.MD"), "upper");
  expect(expandGlob("adr/*.md", root)).toEqual(["adr/a.md"]);
  expect(expandGlob("adr/[A-Z]*.MD", root)).toEqual(["adr/UPPER.MD"]);
  expect(expandGlob("ADR/*.md", root)).toEqual([]);
});

it("distinguishes a non-directory literal prefix from zero matches", () => {
  const root = fixture();
  expect(() => expandGlob("adr/a.md/*.md", root)).toThrow(
    expect.objectContaining({ code: "GLOB_UNREADABLE" }),
  );
});

it("propagates EIO from strict enumeration even after other matches were found", () => {
  const root = fixture();
  expect(() =>
    expandGlob("adr/**/*.md", root, (directory) => {
      if (directory.endsWith("nested"))
        throw Object.assign(new Error("EIO: injected read failure"), { code: "EIO" });
      return readdirSync(directory);
    }),
  ).toThrow(
    expect.objectContaining({ code: "GLOB_UNREADABLE", message: expect.stringContaining("EIO") }),
  );
});

it.skipIf(process.platform === "win32")(
  "selects special files for explicit rejection without opening a FIFO",
  () => {
    const root = fixture();
    const fifo = join(root, "adr/pipe.md");
    const created = spawnSync("mkfifo", [fifo]);
    expect(created.status).toBe(0);
    expect(expandGlob("adr/*.md", root)).toContain("adr/pipe.md");
    expect(() => hashFile(fifo)).toThrow(expect.objectContaining({ code: "NOT_A_FILE" }));
  },
);
