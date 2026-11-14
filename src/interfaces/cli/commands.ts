import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { CrosslinkError, problem } from "../../domain/errors.js";
import type { Group } from "../../domain/group.js";
import { inspectGroup } from "../../application/inspect-group.js";
import {
  confirmGroups,
  createGroup,
  deleteGroup,
  updateGroup,
} from "../../application/group-operations.js";
import type { ApplicationMetadata, CrosslinkPorts } from "../../application/ports.js";

export type { Report } from "../../application/inspection-report.js";
import { inspectionReport as inspect, type Report } from "../../application/inspection-report.js";
import { generateReport, type ReportServices } from "../../application/report.js";

export interface RunResult {
  code: number;
  report: Report;
  verbose?: boolean;
}

function stored(member: string, file: string, cwd: string): string {
  return isAbsolute(member)
    ? member
    : relative(dirname(file), resolve(cwd, member)).split(sep).join("/");
}

function snapshot(file: string, ports: CrosslinkPorts): Map<string, string> {
  const guidance = `Snapshot report: ${file}. Run check --json again and read all related files before confirming with the new report.`;
  let value: unknown;
  try {
    value = JSON.parse(ports.groups.readRaw(file));
  } catch (error) {
    const detail = problem(error);
    throw new CrosslinkError(detail.code, `${detail.message} ${guidance}`);
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("groups" in value) ||
    !Array.isArray(value.groups)
  )
    throw new CrosslinkError("INVALID_SNAPSHOT", `Provide the inspection report JSON. ${guidance}`);
  const expected = new Map<string, string>();
  for (const group of value.groups) {
    if (
      !group ||
      typeof group !== "object" ||
      typeof group.file !== "string" ||
      !isAbsolute(group.file)
    )
      throw new CrosslinkError(
        "INVALID_SNAPSHOT",
        `Invalid target path in the inspection report. ${guidance}`,
      );
    if (expected.has(group.file))
      throw new CrosslinkError(
        "INVALID_SNAPSHOT",
        `Duplicate target in the inspection report. ${guidance}`,
      );
    if (group.snapshot === null) {
      expected.set(group.file, "");
      continue;
    }
    if (typeof group.snapshot !== "string" || !/^[a-f0-9]{64}$/.test(group.snapshot))
      throw new CrosslinkError(
        "INVALID_SNAPSHOT",
        `Invalid snapshot in the inspection report. ${guidance}`,
      );
    expected.set(group.file, group.snapshot);
  }
  return expected;
}

const help = [
  "crosslink create <name> [files...] --reason <reason> [--file <destination>]",
  "crosslink add|remove <group-file> <files...>",
  "crosslink set <group-file> [--name <name>] [--reason <reason>]",
  "crosslink delete <group-file>",
  "crosslink migrate <legacy-group-file>",
  "crosslink check [--file <group-file>] [-v | --verbose] [--json]",
  "crosslink report --format html --output <path> [--file <group-file>]",
  "crosslink related <target-file> [--file <group-file>] [--json]",
  "crosslink confirm <group-file> --snapshot <report.json>",
  "crosslink confirm --all --snapshot <report.json>",
  "crosslink --version",
  "Options: --config <config.json>, --json, -h, --help",
  "Check details: -v, --verbose (all groups, files and reasons)",
];

export function run(
  args: string[],
  cwd: string,
  ports: CrosslinkPorts,
  metadata: ApplicationMetadata,
  reports: ReportServices,
): RunResult {
  let operation = "unknown";
  try {
    const { values, positionals, tokens } = parseArgs({
      tokens: true,
      args,
      allowPositionals: true,
      options: {
        file: { type: "string", multiple: true },
        reason: { type: "string" },
        name: { type: "string" },
        format: { type: "string" },
        output: { type: "string" },
        snapshot: { type: "string" },
        all: { type: "boolean" },
        config: { type: "string" },
        json: { type: "boolean" },
        verbose: { type: "boolean", short: "v" },
        version: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    operation = values.version ? "version" : (positionals[0] ?? "help");
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
      check: ["file", "verbose"],
      report: ["file", "format", "output"],
      version: ["version"],
      related: ["file"],
      confirm: ["all", "snapshot"],
    };
    if (!allowed[operation])
      throw new CrosslinkError("INVALID_ARGUMENT", `Unknown command: ${operation}`);
    for (const key of Object.keys(values))
      if (!["config", "json", "help", ...allowed[operation]!].includes(key))
        throw new CrosslinkError(
          "INVALID_ARGUMENT",
          `Option --${key} is not supported by this command.`,
        );
    if (operation === "version") {
      if (positionals.length || values.config !== undefined)
        throw new CrosslinkError(
          "INVALID_ARGUMENT",
          "Use --version without a command or configuration.",
        );
      return {
        code: 0,
        report: {
          version: 1,
          operation,
          result: "ok",
          groups: [],
          errors: [],
          messages: [metadata.version()],
        },
      };
    }
    if (operation === "report") {
      if (
        positionals.length !== 1 ||
        values.format !== "html" ||
        !values.output?.trim() ||
        ["format", "output"].some(
          (name) =>
            tokens.filter((token) => token.kind === "option" && token.name === name).length !== 1,
        )
      )
        throw new CrosslinkError(
          "INVALID_ARGUMENT",
          "Use report --format html --output <path>, with each required option exactly once and no positional targets.",
        );
      return generateReport(
        {
          cwd,
          output: values.output,
          ...(values.file ? { files: values.file } : {}),
          ...(values.config !== undefined ? { config: values.config } : {}),
        },
        ports,
        metadata,
        reports,
      );
    }
    const settings = ports.configuration.load(cwd, values.config);
    const positional = positionals.slice(1);
    if (operation === "check" || operation === "related") {
      if (positional.length !== (operation === "related" ? 1 : 0))
        throw new CrosslinkError("INVALID_ARGUMENT", "Check the number of target files.");
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
      return { ...inspect(operation, groups), verbose: values.verbose ?? false };
    }
    if (operation === "confirm") {
      if (!values.snapshot || (values.all ? positional.length !== 0 : positional.length !== 1))
        throw new CrosslinkError(
          "INVALID_ARGUMENT",
          "Select one group or use --all, and provide an inspection report with --snapshot.",
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
      throw new CrosslinkError("INVALID_ARGUMENT", "Specify a group name or management file.");
    let file: string;
    if (operation === "create") {
      if (!values.reason || (values.file?.length ?? 0) > 1)
        throw new CrosslinkError(
          "INVALID_ARGUMENT",
          "Provide --reason and optionally one destination with --file.",
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
          throw new CrosslinkError("INVALID_ARGUMENT", "Specify one management file to delete.");
        deleteGroup(file, ports);
        return {
          code: 0,
          report: {
            version: 1,
            operation,
            result: "ok",
            groups: [],
            errors: [],
            messages: [`Deleted group: ${file}`],
          },
        };
      }
      if (operation === "migrate" && positional.length !== 1)
        throw new CrosslinkError("INVALID_ARGUMENT", "Specify one management file to migrate.");
      if (
        operation === "set" &&
        (positional.length !== 1 || (values.name === undefined && values.reason === undefined))
      )
        throw new CrosslinkError("INVALID_ARGUMENT", "Provide --name or --reason.");
      if ((operation === "add" || operation === "remove") && positional.length < 2)
        throw new CrosslinkError("INVALID_ARGUMENT", "Specify the member files to change.");
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
              throw new CrosslinkError("NOT_A_MEMBER", `Not a registered member: ${target}`);
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
        messages: ["Saved. See inspection results for the current confirmation status."],
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
