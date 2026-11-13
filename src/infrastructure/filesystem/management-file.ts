import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import { CrosslinkError } from "../../domain/errors.js";
import type { Group } from "../../domain/group.js";
import { groupKind, parseGroup } from "./group-format.js";
import type { Settings } from "../../application/ports.js";

export function readGroup(file: string): { group: Group; raw: string } {
  if (lstatSync(file).isSymbolicLink())
    throw new CrosslinkError(
      "MANAGEMENT_SYMLINK",
      "管理ファイル自体へのシンボリックリンクは使用できません",
    );
  const raw = readFileSync(file, "utf8");
  return { group: parseGroup(raw), raw };
}

export function isManagementFile(member: string, file: string, settings: Settings): boolean {
  const canonical = existsSync(member) ? realpathSync(member) : resolve(member);
  const storage = existsSync(file) ? realpathSync(file) : resolve(file);
  if (
    canonical === storage ||
    (canonical.endsWith(".json") && canonical.split(sep).includes(settings.directoryName))
  )
    return true;
  if (existsSync(member) && existsSync(file)) {
    const a = statSync(member),
      b = statSync(file);
    if (a.dev === b.dev && a.ino === b.ino) return true;
  }
  return existsSync(canonical) && statSync(canonical).isFile() && declaresManagementKind(canonical);
}

function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function declaresManagementKind(file: string): boolean {
  // バイナリや通常のソースを全文デコードせず、JSONオブジェクト候補だけ種別を見る。
  const fd = openSync(file, "r");
  const buffer = Buffer.alloc(4096);
  let firstChunk = true;
  let objectCandidate = false;
  try {
    search: while (true) {
      const length = readSync(fd, buffer, 0, buffer.length, null);
      if (length === 0) return false;
      let start = 0;
      if (
        firstChunk &&
        length >= 3 &&
        buffer[0] === 0xef &&
        buffer[1] === 0xbb &&
        buffer[2] === 0xbf
      )
        start = 3;
      firstChunk = false;
      for (let i = start; i < length; i++) {
        const byte = buffer[i];
        if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
        objectCandidate = byte === 0x7b;
        break search;
      }
    }
  } finally {
    closeSync(fd);
  }
  if (!objectCandidate) return false;
  try {
    const value: unknown = JSON.parse(withoutBom(readFileSync(file, "utf8")));
    return object(value) && value.kind === groupKind;
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}
