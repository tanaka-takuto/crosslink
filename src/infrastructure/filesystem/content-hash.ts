import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { CrosslinkError } from "../../domain/errors.js";

export function digest(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function hashFile(file: string): { hash: string; identity: string } {
  if (!statSync(file).isFile())
    throw new CrosslinkError(
      "NOT_A_FILE",
      `Not a regular file: ${file}. Update the registered path to a regular file, then run check again.`,
    );
  const fd = openSync(file, "r");
  try {
    // ID/sizeの整数精度を保ち、時刻はBigIntのms値でなくns値で比較する。
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile())
      throw new CrosslinkError(
        "NOT_A_FILE",
        `Not a regular file: ${file}. Update the registered path to a regular file, then run check again.`,
      );
    const hash = createHash("sha256"),
      buffer = Buffer.alloc(64 * 1024);
    let bytes: number;
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0)
      hash.update(buffer.subarray(0, bytes));
    const after = fstatSync(fd, { bigint: true });
    if (
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      throw new CrosslinkError("FILE_CHANGED", `File changed while being read: ${file}`);
    const current = statSync(file, { bigint: true });
    if (
      current.dev !== after.dev ||
      current.ino !== after.ino ||
      current.size !== after.size ||
      current.mtimeNs !== after.mtimeNs ||
      current.ctimeNs !== after.ctimeNs
    )
      throw new CrosslinkError("FILE_CHANGED", `File changed while being read: ${file}`);
    return {
      hash: hash.digest("hex"),
      identity: realpathSync.native(file),
    };
  } finally {
    closeSync(fd);
  }
}
