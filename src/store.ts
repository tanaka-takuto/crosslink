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
import {
  CrosslinkError,
  type Group,
  type Settings,
  defaults,
  definition,
  digest,
  groupKind,
  inspectGroup,
  isManagementFile,
  parseGroup,
  readGroup,
} from "./core.js";

function withoutRecord(group: Group): Group {
  return { version: 1, name: group.name, reason: group.reason, files: [...group.files].sort() };
}

function validateMembers(file: string, group: Group, settings: Settings): void {
  parseGroup(JSON.stringify(group));
  const identities = new Set<string>();
  for (const member of group.files) {
    const target = resolve(dirname(file), member);
    if (isManagementFile(target, file, settings))
      throw new CrosslinkError(
        "MANAGEMENT_FILE",
        `確認記録ファイルは関連対象にできません: ${member}`,
      );
    if (!statSync(target).isFile())
      throw new CrosslinkError("NOT_A_FILE", `通常のファイルではありません: ${member}`);
    const identity = realpathSync(target);
    if (identities.has(identity))
      throw new CrosslinkError(
        "DUPLICATE_MEMBER",
        `同じ実ファイルが複数登録されています: ${member}`,
      );
    identities.add(identity);
  }
}

function withLocks<T>(files: string[], operation: () => T): T {
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
            `別の更新が実行中です。更新していないことを確認してからロックを調べてください: ${file}.lock`,
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

function save(file: string, group: Group, create = false): void {
  const temporary = join(dirname(file), `.crosslink-write-${randomUUID()}.tmp`);
  const fd = openSync(temporary, "wx", existsSync(file) ? statSync(file).mode & 0o777 : 0o644);
  try {
    try {
      const stored: Group = {
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

export function createGroup(file: string, group: Group, settings: Settings = defaults): void {
  file = resolve(file);
  const prepared = withoutRecord(group);
  validateMembers(file, prepared, settings);
  withLocks([file], () => {
    if (existsSync(file))
      throw new CrosslinkError("ALREADY_EXISTS", `管理ファイルは既に存在します: ${file}`);
    save(file, prepared, true);
  });
}

export function updateGroup(
  file: string,
  update: (group: Group) => Group,
  settings: Settings = defaults,
): void {
  file = resolve(file);
  withLocks([file], () => {
    const old = readGroup(file).group;
    const next = withoutRecord(update(structuredClone(old)));
    validateMembers(file, next, settings);
    if (definition(old) === definition(next) && old.confirmation)
      next.confirmation = old.confirmation;
    save(file, next);
  });
}

export function confirmGroups(
  files: string[],
  expected: Map<string, string>,
  settings: Settings = defaults,
): void {
  files = [...new Set(files.map((file) => resolve(file)))].sort();
  if (files.length === 0)
    throw new CrosslinkError("NO_SELECTION", "確認対象のグループを指定してください");
  withLocks(files, () => {
    const prepared = files.map((file) => {
      const { group, raw } = readGroup(file);
      const current = inspectGroup(file, settings);
      if (current.errors.length || !current.snapshot)
        throw new CrosslinkError("INVALID_GROUP", `検査できないグループは確認できません: ${file}`);
      if (current.snapshot !== expected.get(file))
        throw new CrosslinkError(
          "STALE_SNAPSHOT",
          `検査後に状態が変わりました。もう一度検査してください: ${file}`,
        );
      if (
        current.snapshot !==
        digest(
          JSON.stringify({
            file,
            raw,
            files: current.files.map((entry) => [entry.path, entry.hash]),
          }),
        )
      )
        throw new CrosslinkError("STALE_SNAPSHOT", `検査中に管理情報が変わりました: ${file}`);
      group.confirmation = {
        definition: definition(group),
        hashes: Object.fromEntries(current.files.map((entry) => [entry.path, entry.hash!])),
      };
      return { file, group };
    });
    const updated: string[] = [];
    try {
      for (const item of prepared) {
        save(item.file, item.group);
        updated.push(item.file);
      }
    } catch (error) {
      throw new CrosslinkError(
        "WRITE_FAILED",
        `確認記録の保存に失敗しました。更新済み: ${JSON.stringify(updated)}。${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

export function deleteGroup(file: string): void {
  file = resolve(file);
  withLocks([file], () => {
    readGroup(file);
    unlinkSync(file);
  });
}
