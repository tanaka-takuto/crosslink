import { validateGlob } from "../../domain/glob.js";
import * as path from "node:path";

export function storedGlob(
  pattern: string,
  file: string,
  cwd: string,
  paths: Pick<typeof path, "isAbsolute" | "relative" | "dirname" | "sep"> = path,
): string {
  validateGlob(pattern);
  const portable = pattern.replaceAll("\\", "/");
  if (paths.isAbsolute(portable)) return portable;
  const prefix = paths.relative(paths.dirname(file), cwd).split(paths.sep).join("/");
  // CWD由来の実パスに含まれるglob文字をリテラルとして保持する。
  const literal = prefix.replace(/[?*[\]{}()]/g, (character) =>
    character === "]" ? "[]]" : `[${character}]`,
  );
  return [literal, portable.replace(/^(\.\/)+/, "")].filter(Boolean).join("/");
}
