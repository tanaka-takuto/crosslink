import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CrosslinkError } from "../../domain/errors.js";
import type { Group } from "../../domain/group.js";
import { groupKind, type GroupRecord } from "./group-format.js";

export function withLocks<T>(files: string[], operation: () => T): T {
  const locks: { file: string; fd: number }[] = [];
  try {
    for (const input of [...new Set(files.map((file) => resolve(file)))].sort()) {
      mkdirSync(dirname(input), { recursive: true });
      const file = existsSync(input)
        ? realpathSync(input)
        : join(realpathSync(dirname(input)), basename(input));
      let fd: number;
      try {
        fd = openSync(file + ".lock", "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new CrosslinkError(
            "GROUP_LOCKED",
            `Another update is in progress. Ensure no update is running before inspecting the lock: ${file}.lock`,
          );
        throw error;
      }
      locks.push({ file: file + ".lock", fd });
      writeFileSync(fd, String(process.pid));
    }
    return operation();
  } finally {
    for (const lock of locks.reverse()) {
      closeSync(lock.fd);
      unlinkSync(lock.file);
    }
  }
}

export function saveGroup(file: string, group: Group, create = false): void {
  const temporary = join(dirname(file), `.crosslink-write-${randomUUID()}.tmp`);
  const fd = openSync(temporary, "wx", existsSync(file) ? statSync(file).mode & 0o777 : 0o644);
  try {
    try {
      const stored: GroupRecord = {
        kind: groupKind,
        version: 1,
        name: group.name,
        reason: group.reason,
        files: group.files,
      };
      if (group.confirmation) stored.confirmation = group.confirmation;
      writeFileSync(fd, JSON.stringify(stored, null, 2) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // 新規作成では既存ファイルを上書きしない。更新では同じディレクトリ内で置換する。
    if (create) linkSync(temporary, file);
    else renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
