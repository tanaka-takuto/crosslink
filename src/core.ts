import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";

export interface Settings {
  directoryName: string;
  fileNameTemplate: string;
}

export const defaults: Settings = { directoryName: ".crosslink", fileNameTemplate: "{name}.json" };

export interface Group {
  version: 1;
  name: string;
  reason: string;
  files: string[];
  confirmation?: { definition: string; hashes: Record<string, string> };
}

export interface Problem {
  code: string;
  message: string;
}

export interface Inspection {
  file: string;
  name: string;
  reason: string;
  status: "confirmed" | "unconfirmed";
  files: { path: string; hash: string | null; changed: boolean | null }[];
  snapshot: string | null;
  errors: Problem[];
}

export class CrosslinkError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "CrosslinkError";
  }
}

export function problem(error: unknown): Problem {
  return {
    code: error instanceof CrosslinkError ? error.code : "IO_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function digest(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fields(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new CrosslinkError("INVALID_DEFINITION", "未対応の項目が含まれています");
}

export function parseGroup(text: string): Group {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CrosslinkError("INVALID_JSON", "管理ファイルのJSONが壊れています");
  }
  if (!object(value))
    throw new CrosslinkError("INVALID_DEFINITION", "管理ファイルはオブジェクトにしてください");
  fields(value, ["version", "name", "reason", "files", "confirmation"]);
  if (value.version !== 1)
    throw new CrosslinkError("UNSUPPORTED_VERSION", "管理ファイルのversionは1のみ対応しています");
  if (
    typeof value.name !== "string" ||
    !value.name.trim() ||
    typeof value.reason !== "string" ||
    !value.reason.trim()
  )
    throw new CrosslinkError("INVALID_DEFINITION", "名前と確認が必要な理由は必須です");
  if (
    !Array.isArray(value.files) ||
    value.files.some((file) => typeof file !== "string" || !file.trim() || file.includes("\0"))
  )
    throw new CrosslinkError("INVALID_DEFINITION", "filesにはファイルパスの配列を指定してください");
  if (new Set(value.files).size !== value.files.length)
    throw new CrosslinkError("DUPLICATE_MEMBER", "同じパスが複数登録されています");
  if (value.confirmation !== undefined) {
    const confirmation = value.confirmation;
    if (!object(confirmation))
      throw new CrosslinkError("INVALID_CONFIRMATION", "確認記録が壊れています");
    fields(confirmation, ["definition", "hashes"]);
    const hex = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
    if (
      !hex(confirmation.definition) ||
      !object(confirmation.hashes) ||
      Object.values(confirmation.hashes).some((hash) => !hex(hash))
    )
      throw new CrosslinkError("INVALID_CONFIRMATION", "確認記録のハッシュが不正です");
  }
  return value as unknown as Group;
}

export function definition(group: Group): string {
  return digest(
    JSON.stringify({ name: group.name, reason: group.reason, files: [...group.files].sort() }),
  );
}

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
  if (canonical.endsWith(".json") && existsSync(canonical) && statSync(canonical).isFile()) {
    try {
      parseGroup(readFileSync(canonical, "utf8"));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function hashFile(file: string): { hash: string; identity: string } {
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

export function inspectGroup(file: string, settings: Settings = defaults): Inspection {
  file = resolve(file);
  const result: Inspection = {
    file,
    name: basename(file),
    reason: "",
    status: "unconfirmed",
    files: [],
    snapshot: null,
    errors: [],
  };
  try {
    const { group, raw } = readGroup(file);
    result.name = group.name;
    result.reason = group.reason;
    if (group.files.length < 2)
      result.errors.push({ code: "TOO_FEW_FILES", message: "検査には2ファイル以上が必要です" });
    const identities = new Set<string>();
    for (const member of [...group.files].sort()) {
      const entry: Inspection["files"][number] = {
        path: member,
        hash: null,
        changed: group.confirmation ? true : null,
      };
      result.files.push(entry);
      try {
        const target = resolve(dirname(file), member);
        if (isManagementFile(target, file, settings))
          throw new CrosslinkError(
            "MANAGEMENT_FILE",
            `確認記録ファイルは関連対象にできません: ${member}`,
          );
        const current = hashFile(target);
        if (identities.has(current.identity))
          throw new CrosslinkError(
            "DUPLICATE_MEMBER",
            `同じ実ファイルが複数登録されています: ${member}`,
          );
        identities.add(current.identity);
        entry.hash = current.hash;
        entry.changed = group.confirmation
          ? group.confirmation.hashes[member] !== current.hash
          : null;
      } catch (error) {
        result.errors.push(
          error instanceof CrosslinkError
            ? problem(error)
            : { code: "FILE_UNREADABLE", message: `ファイルを読み取れません: ${member}` },
        );
      }
    }
    if (result.errors.length === 0) {
      if (readFileSync(file, "utf8") !== raw)
        throw new CrosslinkError("GROUP_CHANGED", "検査中に管理ファイルが変わりました");
      result.snapshot = digest(
        JSON.stringify({ file, raw, files: result.files.map((entry) => [entry.path, entry.hash]) }),
      );
      if (
        group.confirmation?.definition === definition(group) &&
        result.files.every((entry) => entry.changed === false)
      )
        result.status = "confirmed";
    }
  } catch (error) {
    result.errors.push(problem(error));
  }
  return result;
}
