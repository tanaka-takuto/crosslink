import { expect, it } from "vitest";
import { matchesSegment, matchesGlobPath, validateGlob } from "./glob.js";

it("matches a portable case-sensitive glob grammar with literal regex punctuation", () => {
  for (const [name, pattern] of [
    ["a.md", "*.md"],
    ["a.md", "?.md"],
    ["b.md", "[!a].md"],
    ["a.md", "[a-z].md"],
    ["[1]", "[[]1[]]"],
    ["(draft)", "[(]draft[)]"],
    ["{x}", "[{]x[}]"],
    ["+^$|", "+^$|"],
  ])
    expect(matchesSegment(name!, pattern!)).toBe(true);
  for (const [name, pattern] of [
    ["UPPER.MD", "*.md"],
    [".hidden", "*"],
    ["a.md", "[!a].md"],
    ["file.txt", "*.md"],
  ])
    expect(matchesSegment(name!, pattern!)).toBe(false);
  expect(matchesGlobPath("../adr/nested/a.md", "../adr/**/*.md")).toBe(true);
  expect(matchesGlobPath("../adr/a.md", "../adr/**/*.md")).toBe(true);
  expect(matchesGlobPath("../adr/.hidden/a.md", "../adr/**/*.md")).toBe(false);
});
it("rejects invalid classes and parent traversal after wildcards explicitly", () => {
  for (const pattern of [
    "[",
    "[]",
    "[z-a]",
    "[[:alpha:]]",
    "*/../a",
    "**/../*.md",
    "{a,b}",
    "@(a|b)",
  ])
    expect(() => validateGlob(pattern)).toThrow(
      expect.objectContaining({ code: "INVALID_DEFINITION" }),
    );
  expect(() => validateGlob("../a/../adr/**/*.md")).not.toThrow();
});
