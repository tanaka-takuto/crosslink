import { validateGlob } from "../../domain/glob.js";
import { posix, win32 } from "node:path";
import { expect, it } from "vitest";
import { storedGlob } from "./member-path.js";

it("converts CWD selectors to management-relative paths and rejects unsupported wildcard parent traversal", () => {
  expect(storedGlob("adr/**/*.md", "/repo/.crosslink/g.json", "/repo", posix)).toBe(
    "../adr/**/*.md",
  );
  expect(() =>
    storedGlob("../adr/*/../*.md", "/repo/.crosslink/g.json", "/repo/docs", posix),
  ).toThrow();
  expect(storedGlob("*.md", "/repo/.crosslink/g.json", "/repo/draft [1] (new)", posix)).toBe(
    "../draft [[]1[]] [(]new[)]/*.md",
  );
});
it("preserves Windows absolute and UNC roots and stores portable slash patterns", () => {
  expect(storedGlob(".\\adr\\**\\*.md", "C:\\repo\\.crosslink\\g.json", "C:\\repo", win32)).toBe(
    "../adr/**/*.md",
  );
  expect(storedGlob("C:\\docs\\**\\*.md", "C:\\repo\\.crosslink\\g.json", "C:\\repo", win32)).toBe(
    "C:/docs/**/*.md",
  );
  expect(
    storedGlob("\\\\server\\share\\*.md", "C:\\repo\\.crosslink\\g.json", "C:\\repo", win32),
  ).toBe("//server/share/*.md");
});

it("allows parent paths after literal CWD metacharacters while retaining their literal meaning", () => {
  expect(() =>
    validateGlob(storedGlob("../adr/*.md", "/repo/.crosslink/g.json", "/repo/base[1]", posix)),
  ).not.toThrow();
  expect(storedGlob("../adr/*.md", "/repo/.crosslink/g.json", "/repo/base[1]", posix)).toBe(
    "../base[[]1[]]/../adr/*.md",
  );
  expect(storedGlob("../adr/*.md", "/repo/.crosslink/g.json", "/repo/base{1}", posix)).toBe(
    "../base[{]1[}]/../adr/*.md",
  );
});

it.each([
  { paths: posix, file: "/repo/group.json", cwd: "/repo/!inputs" },
  { paths: win32, file: "C:\\repo\\group.json", cwd: "C:\\repo\\!inputs" },
])("preserves a literal leading bang introduced by CWD rebasing: $cwd", ({ paths, file, cwd }) => {
  const pattern = storedGlob("*.md", file, cwd, paths);
  expect(() => validateGlob(pattern)).not.toThrow();
  expect(pattern).toBe("./!inputs/*.md");
});

it("keeps direct exclusion input rejected while preserving explicitly relative literal bangs", () => {
  expect(() => storedGlob("!*.md", "/repo/group.json", "/repo/!inputs", posix)).toThrow();
  expect(() =>
    validateGlob(storedGlob("./!name.md", "/repo/group.json", "/repo", posix)),
  ).not.toThrow();
  expect(storedGlob("*.md", "/repo/.crosslink/group.json", "/repo/!inputs", posix)).toBe(
    "../!inputs/*.md",
  );
  expect(storedGlob("*.md", "/repo/group.json", "/repo/docs/!inputs", posix)).toBe(
    "docs/!inputs/*.md",
  );
});
