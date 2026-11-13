import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { CrosslinkError, problem, type Problem } from "../../domain/errors.js";
import type { Group } from "../../domain/group.js";
import { inspectGroup, type Inspection } from "../../application/inspect-group.js";
import {
  confirmGroups,
  createGroup,
  deleteGroup,
  updateGroup,
} from "../../application/group-operations.js";
import type { CrosslinkPorts } from "../../application/ports.js";

export interface Report {
  version: 1;
  operation: string;
  result: "ok" | "unconfirmed" | "error";
  groups: Inspection[];
  errors: Problem[];
  messages: string[];
}
export interface RunResult {
  code: number;
  report: Report;
}

function inspect(operation: string, groups: Inspection[]): RunResult {
  const errors = groups.flatMap((group) =>
    group.errors.map((error) => ({ ...error, message: `${group.file}: ${error.message}` })),
  );
  const code = errors.length ? 2 : groups.some((group) => group.status === "unconfirmed") ? 1 : 0;
  return {
    code,
    report: {
      version: 1,
      operation,
      result: code === 2 ? "error" : code === 1 ? "unconfirmed" : "ok",
      groups,
      errors,
      messages: groups.length
        ? []
        : [
            operation === "related"
              ? "このファイルに関連するグループはありません"
              : "登録されたグループはありません",
          ],
    },
  };
}

function stored(member: string, file: string, cwd: string): string {
  return isAbsolute(member)
    ? member
    : relative(dirname(file), resolve(cwd, member)).split(sep).join("/");
}

function snapshot(file: string, ports: CrosslinkPorts): Map<string, string> {
  const value: unknown = JSON.parse(ports.groups.readRaw(file));
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("groups" in value) ||
    !Array.isArray(value.groups)
  )
    throw new CrosslinkError("INVALID_SNAPSHOT", "検査結果のJSONを指定してください");
  const expected = new Map<string, string>();
  for (const group of value.groups) {
    if (
      !group ||
      typeof group !== "object" ||
      typeof group.file !== "string" ||
      !isAbsolute(group.file)
    )
      throw new CrosslinkError("INVALID_SNAPSHOT", "検査結果の対象パスが不正です");
    if (expected.has(group.file))
      throw new CrosslinkError("INVALID_SNAPSHOT", "検査結果の対象が重複しています");
    if (group.snapshot === null) {
      expected.set(group.file, "");
      continue;
    }
    if (typeof group.snapshot !== "string" || !/^[a-f0-9]{64}$/.test(group.snapshot))
      throw new CrosslinkError("INVALID_SNAPSHOT", "検査結果の状態が不正です");
    expected.set(group.file, group.snapshot);
  }
  return expected;
}

const help = [
  "crosslink create <name> [files...] --reason <理由> [--file <保存先>]",
  "crosslink add|remove <管理ファイル> <files...>",
  "crosslink set <管理ファイル> [--name <名前>] [--reason <理由>]",
  "crosslink delete <管理ファイル>",
  "crosslink migrate <旧形式の管理ファイル>",
  "crosslink check [--file <管理ファイル>] [--json]",
  "crosslink related <対象ファイル> [--file <管理ファイル>] [--json]",
  "crosslink confirm <管理ファイル> --snapshot <検査結果.json>",
  "crosslink confirm --all --snapshot <検査結果.json>",
  "共通: --config <設定.json>, --json, --help",
];

export function run(args: string[], cwd: string, ports: CrosslinkPorts): RunResult {
  let operation = "unknown";
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        file: { type: "string", multiple: true },
        reason: { type: "string" },
        name: { type: "string" },
        snapshot: { type: "string" },
        all: { type: "boolean" },
        config: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    operation = positionals[0] ?? "help";
    if (values.help || operation === "help")
      return {
        code: 0,
        report: {
          version: 1,
          operation: "help",
          result: "ok",
          groups: [],
          errors: [],
          messages: help,
        },
      };
    const allowed: Record<string, string[]> = {
      create: ["reason", "file"],
      add: [],
      remove: [],
      set: ["name", "reason"],
      delete: [],
      migrate: [],
      check: ["file"],
      related: ["file"],
      confirm: ["all", "snapshot"],
    };
    if (!allowed[operation])
      throw new CrosslinkError("INVALID_ARGUMENT", `未対応のコマンドです: ${operation}`);
    for (const key of Object.keys(values))
      if (!["config", "json", "help", ...allowed[operation]!].includes(key))
        throw new CrosslinkError("INVALID_ARGUMENT", `このコマンドでは--${key}を使えません`);
    const settings = ports.configuration.load(cwd, values.config);
    const positional = positionals.slice(1);
    if (operation === "check" || operation === "related") {
      if (positional.length !== (operation === "related" ? 1 : 0))
        throw new CrosslinkError("INVALID_ARGUMENT", "対象ファイルの指定を確認してください");
      const files =
        values.file?.map((file) => resolve(cwd, file)) ??
        ports.configuration.findGroups(cwd, settings);
      let groups = [...new Set(files)].sort().map((file) => inspectGroup(file, ports, settings));
      if (operation === "related") {
        const target = ports.files.canonical(resolve(cwd, positional[0]!));
        groups = groups.filter(
          (group) =>
            group.errors.length ||
            group.files.some(
              (member) =>
                ports.files.canonical(resolve(dirname(group.file), member.path)) === target,
            ),
        );
      }
      return inspect(operation, groups);
    }
    if (operation === "confirm") {
      if (!values.snapshot || (values.all ? positional.length !== 0 : positional.length !== 1))
        throw new CrosslinkError(
          "INVALID_ARGUMENT",
          "対象を一つ指定するか--allを使い、--snapshotで検査結果を渡してください",
        );
      const expected = snapshot(resolve(cwd, values.snapshot), ports);
      const files = values.all ? [...expected.keys()] : [resolve(cwd, positional[0]!)];
      confirmGroups(files, expected, ports, settings);
      return inspect(
        operation,
        files.map((file) => inspectGroup(file, ports, settings)),
      );
    }
    if (!positional[0])
      throw new CrosslinkError(
        "INVALID_ARGUMENT",
        "グループ名または管理ファイルを指定してください",
      );
    let file: string;
    if (operation === "create") {
      if (!values.reason || (values.file?.length ?? 0) > 1)
        throw new CrosslinkError(
          "INVALID_ARGUMENT",
          "--reasonと、必要なら保存先を一つ指定してください",
        );
      file = values.file?.[0]
        ? resolve(cwd, values.file[0])
        : ports.configuration.groupFile(positional[0], cwd, settings);
      const group: Group = {
        name: positional[0],
        reason: values.reason,
        files: positional.slice(1).map((member) => stored(member, file, cwd)),
      };
      createGroup(file, group, ports, settings);
    } else {
      file = resolve(cwd, positional[0]);
      if (operation === "delete") {
        if (positional.length !== 1)
          throw new CrosslinkError(
            "INVALID_ARGUMENT",
            "削除する管理ファイルを一つ指定してください",
          );
        deleteGroup(file, ports);
        return {
          code: 0,
          report: {
            version: 1,
            operation,
            result: "ok",
            groups: [],
            errors: [],
            messages: [`グループを削除しました: ${file}`],
          },
        };
      }
      if (operation === "migrate" && positional.length !== 1)
        throw new CrosslinkError("INVALID_ARGUMENT", "移行する管理ファイルを一つ指定してください");
      if (
        operation === "set" &&
        (positional.length !== 1 || (values.name === undefined && values.reason === undefined))
      )
        throw new CrosslinkError("INVALID_ARGUMENT", "--nameまたは--reasonを指定してください");
      if ((operation === "add" || operation === "remove") && positional.length < 2)
        throw new CrosslinkError("INVALID_ARGUMENT", "変更する対象ファイルを指定してください");
      updateGroup(
        file,
        (group) => {
          if (operation === "migrate") return group;
          if (operation === "set")
            return {
              ...group,
              name: values.name ?? group.name,
              reason: values.reason ?? group.reason,
            };
          const members = positional.slice(1);
          if (operation === "add")
            return {
              ...group,
              files: [...group.files, ...members.map((member) => stored(member, file, cwd))],
            };
          const targets = new Set(
            members.map((member) => ports.files.canonical(resolve(cwd, member))),
          );
          for (const target of targets)
            if (
              !group.files.some(
                (member) => ports.files.canonical(resolve(dirname(file), member)) === target,
              )
            )
              throw new CrosslinkError("NOT_A_MEMBER", `登録されていません: ${target}`);
          return {
            ...group,
            files: group.files.filter(
              (member) => !targets.has(ports.files.canonical(resolve(dirname(file), member))),
            ),
          };
        },
        ports,
        settings,
      );
    }
    const current = inspectGroup(file, ports, settings);
    return {
      code: 0,
      report: {
        version: 1,
        operation,
        result: "ok",
        groups: [current],
        errors: [],
        messages: ["保存しました。現在の確認状態は検査結果を参照してください"],
      },
    };
  } catch (error) {
    return {
      code: 2,
      report: {
        version: 1,
        operation,
        result: "error",
        groups: [],
        errors: [problem(error)],
        messages: [],
      },
    };
  }
}

export function human(report: Report, cwd: string): string {
  const lines = [...report.messages];
  for (const group of report.groups) {
    lines.push(
      `${group.status === "confirmed" ? "確認済み" : "未確認"}: ${group.name} (${relative(cwd, group.file)})`,
      `  確認が必要な理由: ${group.reason}`,
    );
    for (const file of group.files)
      lines.push(
        `  ${file.changed === null ? "初回" : file.changed ? "変更" : "未変更"}: ${file.path}`,
      );
    for (const error of group.errors) lines.push(`  ${error.code}: ${error.message}`);
  }
  return lines.join("\n") + "\n";
}
