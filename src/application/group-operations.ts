import { dirname, resolve } from "node:path";
import { CrosslinkError } from "../domain/errors.js";
import { canonicalDefinition, validateGroup, type Group } from "../domain/group.js";
import { inspectGroup } from "./inspect-group.js";
import type { CrosslinkPorts, Settings } from "./ports.js";

function withoutRecord(group: Group): Group {
  return { name: group.name, reason: group.reason, files: [...group.files].sort() };
}

function validateMembers(
  file: string,
  group: Group,
  ports: CrosslinkPorts,
  settings: Settings,
): void {
  validateGroup(group);
  const identities = new Set<string>();
  for (const member of group.files) {
    const target = resolve(dirname(file), member);
    if (ports.files.isManagementFile(target, file, settings))
      throw new CrosslinkError(
        "MANAGEMENT_FILE",
        `確認記録ファイルは関連対象にできません: ${member}`,
      );
    const current = ports.files.info(target);
    if (!current.isFile)
      throw new CrosslinkError("NOT_A_FILE", `通常のファイルではありません: ${member}`);
    const identity = current.identity;
    if (identities.has(identity))
      throw new CrosslinkError(
        "DUPLICATE_MEMBER",
        `同じ実ファイルが複数登録されています: ${member}`,
      );
    identities.add(identity);
  }
}

export function createGroup(
  file: string,
  group: Group,
  ports: CrosslinkPorts,
  settings: Settings,
): void {
  file = resolve(file);
  const prepared = withoutRecord(group);
  validateMembers(file, prepared, ports, settings);
  ports.groups.withLocks([file], () => {
    if (ports.groups.exists(file))
      throw new CrosslinkError("ALREADY_EXISTS", `管理ファイルは既に存在します: ${file}`);
    ports.groups.write(file, prepared, true);
  });
}

export function updateGroup(
  file: string,
  update: (group: Group) => Group,
  ports: CrosslinkPorts,
  settings: Settings,
): void {
  file = resolve(file);
  ports.groups.withLocks([file], () => {
    const old = ports.groups.read(file).group;
    const next = withoutRecord(update(structuredClone(old)));
    validateMembers(file, next, ports, settings);
    if (
      ports.digest(canonicalDefinition(old)) === ports.digest(canonicalDefinition(next)) &&
      old.confirmation
    )
      next.confirmation = old.confirmation;
    ports.groups.write(file, next);
  });
}

export function confirmGroups(
  files: string[],
  expected: Map<string, string>,
  ports: CrosslinkPorts,
  settings: Settings,
): void {
  files = [...new Set(files.map((file) => resolve(file)))].sort();
  if (files.length === 0)
    throw new CrosslinkError("NO_SELECTION", "確認対象のグループを指定してください");
  ports.groups.withLocks(files, () => {
    const prepared = files.map((file) => {
      const { group, raw } = ports.groups.read(file);
      const current = inspectGroup(file, ports, settings);
      if (current.errors.length || !current.snapshot)
        throw new CrosslinkError("INVALID_GROUP", `検査できないグループは確認できません: ${file}`);
      if (current.snapshot !== expected.get(file))
        throw new CrosslinkError(
          "STALE_SNAPSHOT",
          `検査後に状態が変わりました。もう一度検査してください: ${file}`,
        );
      if (
        current.snapshot !==
        ports.digest(
          JSON.stringify({
            file,
            raw,
            files: current.files.map((entry) => [entry.path, entry.hash]),
          }),
        )
      )
        throw new CrosslinkError("STALE_SNAPSHOT", `検査中に管理情報が変わりました: ${file}`);
      group.confirmation = {
        definition: ports.digest(canonicalDefinition(group)),
        hashes: Object.fromEntries(current.files.map((entry) => [entry.path, entry.hash!])),
      };
      return { file, group };
    });
    const updated: string[] = [];
    try {
      for (const item of prepared) {
        ports.groups.write(item.file, item.group);
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

export function deleteGroup(file: string, ports: CrosslinkPorts): void {
  file = resolve(file);
  ports.groups.withLocks([file], () => {
    ports.groups.read(file);
    ports.groups.delete(file);
  });
}
