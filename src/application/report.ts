import { dirname, resolve } from "node:path";
import { CrosslinkError, problem } from "../domain/errors.js";
import { inspectGroup } from "./inspect-group.js";
import { inspectionReport, type InspectionResult, type Report } from "./inspection-report.js";
import type { ApplicationMetadata, CrosslinkPorts } from "./ports.js";

export interface HtmlReport {
  inspection: Report;
  generatedAt: string;
  applicationVersion: string;
  scope: {
    cwd: string;
    selection: string[] | null;
    configuration: string;
    complete: boolean;
  };
}

export interface ReportServices {
  render(report: HtmlReport): string;
  writeNew(file: string, html: string): void;
  now(): string;
}

export function generateReport(
  request: { cwd: string; output: string; files?: string[]; config?: string },
  ports: CrosslinkPorts,
  metadata: ApplicationMetadata,
  services: ReportServices,
): InspectionResult {
  const cwd = resolve(request.cwd);
  const output = resolve(cwd, request.output);
  const selection = request.files?.map((file) => resolve(cwd, file)) ?? null;
  const configuration = resolve(cwd, request.config ?? "crosslink.config.json");
  let result = inspectionReport("report", []);
  let complete = false;
  try {
    const settings = ports.configuration.load(cwd, request.config);
    const files = selection ?? ports.configuration.findGroups(cwd, settings);
    result = inspectionReport(
      "report",
      [...new Set(files)].sort().map((file) => inspectGroup(file, ports, settings)),
    );
    complete = true;
  } catch (error) {
    result.code = 2;
    result.report.result = "error";
    result.report.messages = [];
    result.report.errors.push(problem(error));
  }
  try {
    const protectedPaths = [
      configuration,
      ...(selection ?? []),
      ...result.report.groups.flatMap((group) => [
        group.file,
        ...group.files.map((member) => resolve(dirname(group.file), member.path)),
      ]),
    ];
    // 読取不能な入力の実体パスを取得できなくても、描画可能な診断は保存する。
    // 既存先への置換は書出しアダプターでも必ず拒否する。
    const canonical = (file: string): string => {
      try {
        return ports.files.canonical(file);
      } catch {
        return resolve(file);
      }
    };
    const outputIdentity = canonical(output);
    if (
      protectedPaths.some((file) => resolve(file) === output || canonical(file) === outputIdentity)
    )
      throw new CrosslinkError(
        "REPORT_INPUT_COLLISION",
        `Report output is an input file: ${output}. Choose a different output path.`,
      );
    const html = services.render({
      inspection: result.report,
      generatedAt: services.now(),
      applicationVersion: metadata.version(),
      scope: { cwd, selection, configuration, complete },
    });
    services.writeNew(output, html);
    result.report.messages.push(`HTML report saved: ${output}`);
  } catch (error) {
    result.code = 2;
    result.report.result = "error";
    result.report.errors.push(problem(error));
  }
  return result;
}
