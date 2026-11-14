import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { writeNewReport } from "./report-output.js";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "crosslink-report-output-"));
  roots.push(root);
  return root;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it("writes a new report without leaving temporary files", () => {
  const root = fixture();
  writeNewReport(join(root, "report.html"), "<!doctype html>日本語");
  expect(readFileSync(join(root, "report.html"), "utf8")).toBe("<!doctype html>日本語");
  expect(readdirSync(root)).toEqual(["report.html"]);
});

it("refuses any existing output and preserves its bytes", () => {
  const root = fixture();
  for (const name of ["report.html", "source.ts", "crosslink.config.json", "group.json"]) {
    const file = join(root, name);
    writeFileSync(file, "original");
    expect(() => writeNewReport(file, "replacement")).toThrow(/different output path/);
    expect(readFileSync(file, "utf8")).toBe("original");
  }
  expect(readdirSync(root).some((name) => name.startsWith(".crosslink-report-"))).toBe(false);
});

it("refuses output symlinks including dangling links", () => {
  const root = fixture();
  const target = join(root, "target");
  writeFileSync(target, "original");
  const link = join(root, "report.html");
  symlinkSync(target, link);
  expect(() => writeNewReport(link, "replacement")).toThrow();
  expect(readFileSync(target, "utf8")).toBe("original");
  const missing = join(root, "missing");
  symlinkSync(missing, join(root, "dangling.html"));
  expect(() => writeNewReport(join(root, "dangling.html"), "replacement")).toThrow();
  expect(existsSync(missing)).toBe(false);
});

it("reports an unwritable destination without creating parent directories", () => {
  const root = fixture();
  expect(() => writeNewReport(join(root, "missing/report.html"), "html")).toThrow(
    /Cannot write HTML report/,
  );
  expect(readdirSync(root)).toEqual([]);
  mkdirSync(join(root, "directory"));
  expect(() => writeNewReport(join(root, "directory"), "html")).toThrow();
});
