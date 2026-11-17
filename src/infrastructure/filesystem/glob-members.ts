import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { hasWildcard, matchesSegment } from "../../domain/glob.js";
import { CrosslinkError } from "../../domain/errors.js";

function selectedNames(directory: string, part: string, names: string[]): string[] {
  const matches = names.filter((name) => matchesSegment(name, part));
  if (matches.length || hasWildcard(part)) return matches;
  const literal = part.replace(/\[(.)\]/gu, "$1");
  if (literal.startsWith(".") && !part.startsWith(".")) return [];
  const normalized = literal.normalize("NFC");
  if (
    names.some(
      (name) =>
        name.normalize("NFC") !== normalized &&
        name.normalize("NFC").toLowerCase() === normalized.toLowerCase(),
    )
  )
    return [];
  let target;
  try {
    target = lstatSync(join(directory, literal));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  // 8.3名等のOS aliasは列挙名と別表記でも同じentry。caseだけの違いは上で拒否する。
  const canonicalName = target.isSymbolicLink()
    ? undefined
    : basename(realpathSync.native(join(directory, literal)));
  const candidates =
    canonicalName === undefined ? names : names.filter((name) => name === canonicalName);
  return candidates.some((name) => {
    const entry = lstatSync(join(directory, name));
    return entry.dev === target.dev && entry.ino === target.ino;
  })
    ? [literal]
    : [];
}

// 未作成出力の保護でも同じliteral選択を使う。可変区間の文法/照合は変えない。
export function canonicalGlobPattern(pattern: string, cwd: string): string | undefined {
  const portable = pattern.replaceAll("\\", "/"),
    absolute = isAbsolute(portable);
  let directory = absolute ? parse(portable).root : resolve(cwd);
  const parts = (absolute ? portable.slice(parse(portable).root.length) : portable)
    .split("/")
    .filter(Boolean);
  let index = 0;
  for (; index < parts.length && !hasWildcard(parts[index]!); index++) {
    const part = parts[index]!;
    if (part === "." || part === "..") {
      directory = resolve(directory, part);
      continue;
    }
    const selected = selectedNames(directory, part, readdirSync(directory));
    if (!selected.length) return undefined;
    directory = join(directory, selected[0]!);
    if (!lstatSync(directory).isDirectory()) return undefined;
  }
  const literal = realpathSync
    .native(directory)
    .split(sep)
    .join("/")
    .replace(/[*?[\]{}()]/gu, (c) => `[${c}]`);
  return [literal, ...parts.slice(index)].join("/");
}

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
    for (const name of selectedNames(directory, part, names)) {
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
