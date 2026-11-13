import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { CrosslinkError } from "../../domain/errors.js";

export function digest(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function hashFile(file: string): { hash: string; identity: string } {
  if (!statSync(file).isFile())
    throw new CrosslinkError("NOT_A_FILE", `通常のファイルではありません: ${file}`);
  const fd = openSync(file, "r");
  try {
    const before = fstatSync(fd);
    if (!before.isFile())
      throw new CrosslinkError("NOT_A_FILE", `通常のファイルではありません: ${file}`);
    const hash = createHash("sha256"),
      buffer = Buffer.alloc(64 * 1024);
    let bytes: number;
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0)
      hash.update(buffer.subarray(0, bytes));
    const after = fstatSync(fd);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new CrosslinkError("FILE_CHANGED", `読取中に内容が変わりました: ${file}`);
    return { hash: hash.digest("hex"), identity: realpathSync(file) };
  } finally {
    closeSync(fd);
  }
}
