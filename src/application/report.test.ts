import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { CrosslinkError } from "../domain/errors.js";
import { filesystemPorts } from "../infrastructure/filesystem/adapter.js";
import { generateReport, type HtmlReport, type ReportServices } from "./report.js";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "crosslink-report-app-"));
  roots.push(root);
  mkdirSync(join(root, ".crosslink"));
  writeFileSync(join(root, "a"), "a");
  writeFileSync(join(root, "b"), "b");
  writeFileSync(
    join(root, ".crosslink/valid.json"),
    JSON.stringify({
      kind: "crosslink-group",
      version: 1,
      name: "valid",
      reason: "理由",
      files: ["../a", "../b"],
    }),
  );
  return root;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function services() {
  let rendered: HtmlReport | undefined;
  const written: string[] = [];
  const ports: ReportServices = {
    now: () => "2026-11-14T00:00:00Z",
    render: (model) => {
      rendered = structuredClone(model);
      return "html";
    },
    writeNew: (file, html) => written.push(file, html),
  };
  return { ports, written, rendered: () => rendered };
}
const metadata = { version: () => "0.4.0" };

it("passes the exact inspection snapshot and metadata to the presenter without altering sources", () => {
  const root = fixture();
  const file = join(root, ".crosslink/valid.json");
  const before = readFileSync(file, "utf8");
  const capture = services();
  const result = generateReport(
    { cwd: root, output: "report.html", files: [file, file] },
    filesystemPorts,
    metadata,
    capture.ports,
  );
  expect(result.code).toBe(1);
  expect(result.report.groups).toHaveLength(1);
  expect(capture.rendered()?.inspection.groups).toEqual(result.report.groups);
  expect(capture.rendered()?.generatedAt).toBe("2026-11-14T00:00:00Z");
  expect(capture.rendered()?.applicationVersion).toBe("0.4.0");
  expect(capture.rendered()?.scope).toMatchObject({
    cwd: root,
    selection: [file, file],
    complete: true,
  });
  expect(capture.written).toEqual([join(root, "report.html"), "html"]);
  expect(readFileSync(file, "utf8")).toBe(before);
});

it("renders discovery failures as incomplete instead of claiming zero registered groups", () => {
  const root = fixture();
  const capture = services();
  const result = generateReport(
    { cwd: root, output: "report.html" },
    {
      ...filesystemPorts,
      configuration: {
        ...filesystemPorts.configuration,
        findGroups: () => {
          throw new CrosslinkError("DISCOVERY_FAILED", "Cannot discover groups");
        },
      },
    },
    metadata,
    capture.ports,
  );
  expect(result.code).toBe(2);
  expect(result.report.messages).not.toContain("No registered groups.");
  expect(capture.rendered()?.scope.complete).toBe(false);
  expect(capture.rendered()?.inspection.errors[0]?.code).toBe("DISCOVERY_FAILED");
  expect(capture.written).toHaveLength(2);
});

it("keeps inspection evidence when writing fails and never reports the output as saved", () => {
  const root = fixture();
  const capture = services();
  capture.ports.writeNew = () => {
    throw new CrosslinkError("REPORT_WRITE_FAILED", "disk failure");
  };
  const result = generateReport(
    { cwd: root, output: "report.html" },
    filesystemPorts,
    metadata,
    capture.ports,
  );
  expect(result.code).toBe(2);
  expect(result.report.groups[0]?.name).toBe("valid");
  expect(result.report.errors.at(-1)?.code).toBe("REPORT_WRITE_FAILED");
  expect(result.report.messages).not.toContain(`HTML report saved: ${join(root, "report.html")}`);
});

it.each([".crosslink/valid.json", "a", "crosslink.config.json", "missing"])(
  "protects a report input path %s including absent members and default configuration",
  (output) => {
    const root = fixture();
    const file = join(root, ".crosslink/valid.json");
    writeFileSync(
      file,
      JSON.stringify({
        kind: "crosslink-group",
        version: 1,
        name: "valid",
        reason: "理由",
        files: ["../a", "../missing"],
      }),
    );
    const capture = services();
    const result = generateReport({ cwd: root, output }, filesystemPorts, metadata, capture.ports);
    expect(result.code).toBe(2);
    expect(result.report.errors.at(-1)?.code).toBe("REPORT_INPUT_COLLISION");
    expect(capture.written).toEqual([]);
  },
);

it("still renders inspection evidence when an input cannot be canonicalized", () => {
  const root = fixture();
  const capture = services();
  const result = generateReport(
    { cwd: root, output: "report.html" },
    {
      ...filesystemPorts,
      files: {
        ...filesystemPorts.files,
        canonical: () => {
          throw new Error("canonicalization unavailable");
        },
      },
    },
    metadata,
    capture.ports,
  );
  expect(result.code).toBe(1);
  expect(capture.written).toEqual([join(root, "report.html"), "html"]);
});
