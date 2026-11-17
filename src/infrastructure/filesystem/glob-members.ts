import { lstatSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { hasWildcard, matchesSegment } from "../../domain/glob.js";
import { CrosslinkError } from "../../domain/errors.js";

// 各ディレクトリを直接読むことで、Node globが省略する探索エラーを検出する。
// OS依存のnocaseやエラー省略に頼らず、制限globで照合しsymlinkへ降りない。
export function expandGlob(
  pattern: string,
  cwd: string,
  readDirectory: (directory: string) => string[] = readdirSync,
): string[] {
  const portable = pattern.replaceAll("\\", "/");
  const absolute = isAbsolute(portable);
  const root = absolute ? parse(portable).root : resolve(cwd);
  const parts = (absolute ? portable.slice(parse(portable).root.length) : portable)
    .split("/")
    .filter(Boolean);
  const found = new Set<string>();
  const visited = new Set<string>();
  let active = root;
  const add = (file: string) => {
    if (!statSync(file).isDirectory())
      found.add((absolute ? resolve(file) : relative(cwd, file)).split(sep).join("/"));
  };
  function walk(directory: string, index: number): void {
    const key = JSON.stringify([directory, index]);
    if (visited.has(key)) return;
    visited.add(key);
    active = directory;
    // 存在しないリテラルディレクトリは0一致。探索中に消えた項目のエラーは丸めない。
    const names = readDirectory(directory).sort();
    const part = parts[index];
    if (part === undefined) return;
    if (part === "." || part === "..") {
      walk(resolve(directory, part), index + 1);
      return;
    }
    if (part === "**") {
      if (index + 1 < parts.length) walk(directory, index + 1);
      for (const name of names.filter((name) => !name.startsWith("."))) {
        const file = join(directory, name);
        active = file;
        const entry = lstatSync(file);
        if (entry.isDirectory()) walk(file, index);
        else if (index === parts.length - 1) add(file);
      }
      return;
    }
    for (const name of names.filter((name) => matchesSegment(name, part))) {
      const file = join(directory, name);
      active = file;
      const entry = lstatSync(file);
      if (index === parts.length - 1) add(file);
      else if (entry.isDirectory()) walk(file, index + 1);
      else if (!hasWildcard(part)) {
        if (entry.isSymbolicLink() && statSync(file).isDirectory()) continue;
        throw new Error(`ENOTDIR: Not a directory: ${file}`);
      }
    }
  }
  try {
    walk(root, 0);
    return [...found].sort();
  } catch (error) {
    throw new CrosslinkError(
      "GLOB_UNREADABLE",
      `Cannot expand glob ${pattern} at ${active}: ${error instanceof Error ? error.message : String(error)}. Check traversal and read permissions, then run check again.`,
    );
  }
}
