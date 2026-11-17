import { CrosslinkError } from "./errors.js";

function invalid(): never {
  throw new CrosslinkError(
    "INVALID_DEFINITION",
    "globs must contain nonempty patterns using *, **, ? or character classes. Exclusion, braces, extglobs and parent traversal after wildcards are not supported.",
  );
}

// NodeのOS依存nocase照合を使わず、制限したglob文法を全OSで同じ意味にする。
export function matchesSegment(name: string, pattern: string): boolean {
  if (name.startsWith(".") && !pattern.startsWith(".")) return false;
  return segmentExpression(pattern).expression.exec(name)?.[0] === name;
}

function segmentExpression(pattern: string): { expression: RegExp; wildcard: boolean } {
  let expression = "";
  let wildcard = false;
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!;
    if (character === "*" || character === "?") {
      wildcard = true;
      expression += character === "*" ? "[^/]*" : "[^/]";
    } else if (character === "[") {
      let start = index + 1;
      const negative = pattern[start] === "!" || pattern[start] === "^";
      if (negative) start++;
      let end = start;
      if (pattern[end] === "]") end++;
      end = pattern.indexOf("]", end);
      if (end === -1 || end === start) invalid();
      const characters = pattern.slice(start, end);
      wildcard ||= negative || [...characters].length !== 1;
      if (characters.includes("/") || (characters.includes("[") && characters !== "[")) invalid();
      const escaped = [...characters]
        .map((character) => ("[]\\^".includes(character) ? "\\" + character : character))
        .join("");
      expression += `[${negative ? "^" : ""}${escaped}]`;
      index = end;
    } else {
      if ("{}()".includes(character)) invalid();
      expression += "\\^$.*+?[]|".includes(character) ? "\\" + character : character;
    }
  }
  try {
    return { expression: new RegExp("^" + expression + "$", "u"), wildcard };
  } catch {
    invalid();
  }
}

export function hasWildcard(segment: string): boolean {
  return segmentExpression(segment).wildcard;
}

export function validateGlob(pattern: unknown): asserts pattern is string {
  if (
    typeof pattern !== "string" ||
    !pattern.trim() ||
    pattern.includes("\0") ||
    pattern.startsWith("!")
  )
    invalid();
  let wildcard = false;
  for (const part of pattern.replaceAll("\\", "/").split("/")) {
    if (wildcard && part === "..") invalid();
    wildcard = segmentExpression(part).wildcard || wildcard;
  }
}

export function matchesGlobPath(path: string, pattern: string): boolean {
  const names = path.split("/").filter(Boolean);
  const parts = pattern.split("/").filter(Boolean);
  const visited = new Set<string>();
  function match(name: number, part: number): boolean {
    const key = `${name}:${part}`;
    if (visited.has(key)) return false;
    visited.add(key);
    if (part === parts.length) return name === names.length;
    if (parts[part] === "**")
      return (
        match(name, part + 1) ||
        (name < names.length && !names[name]!.startsWith(".") && match(name + 1, part))
      );
    return (
      name < names.length && matchesSegment(names[name]!, parts[part]!) && match(name + 1, part + 1)
    );
  }
  return match(0, 0);
}
