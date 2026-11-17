import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { CrosslinkError } from "../domain/errors.js";
import { filesystemPorts } from "../infrastructure/filesystem/adapter.js";
import { generateReport, type HtmlReport, type ReportServices } from "./report.js";
import { confirmGroups } from "./group-operations.js";
import { inspectGroup } from "./inspect-group.js";
import { defaults } from "../infrastructure/filesystem/settings.js";
import { run } from "../interfaces/cli/commands.js";
import { human } from "../interfaces/cli/output.js";
import { renderHtmlReport } from "../interfaces/html/report.js";

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

it("does not create a report at a removed baseline path or a new matching glob path", () => {
  const root = fixture();
  const file = join(root, ".crosslink/valid.json");
  writeFileSync(
    file,
    JSON.stringify({
      kind: "crosslink-group",
      version: 2,
      name: "glob",
      reason: "review",
      files: ["../a", "../b"],
      globs: ["../*.html"],
      confirmation: { definition: "a".repeat(64), hashes: { "../removed.html": "b".repeat(64) } },
    }),
  );
  for (const output of ["removed.html", "new.html"]) {
    const capture = services();
    const result = generateReport({ cwd: root, output }, filesystemPorts, metadata, capture.ports);
    expect(result.report.errors.at(-1)?.code).toBe("REPORT_INPUT_COLLISION");
    expect(capture.written).toEqual([]);
  }
});

it("rejects prospective glob outputs through a directory symlink alias", () => {
  const root = fixture();
  mkdirSync(join(root, "docs"));
  symlinkSync(
    join(root, "docs"),
    join(root, "alias"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const file = join(root, ".crosslink/valid.json");
  writeFileSync(
    file,
    JSON.stringify({
      version: 2,
      name: "docs",
      reason: "review",
      files: ["../a", "../b"],
      globs: ["../docs/*.html"],
    }),
  );
  const capture = services();
  const result = generateReport(
    { cwd: root, output: "alias/new.html" },
    filesystemPorts,
    metadata,
    capture.ports,
  );
  expect(result.report.errors.at(-1)?.code).toBe("REPORT_INPUT_COLLISION");
  expect(capture.written).toEqual([]);
});

it("protects prospective glob outputs through existing native directory aliases", () => {
  const root = fixture();
  mkdirSync(join(root, "café"));
  const literal = existsSync(join(root, "cafe\u0301")) ? "cafe\u0301" : "café";
  writeFileSync(
    join(root, ".crosslink/valid.json"),
    JSON.stringify({
      version: 2,
      name: "valid",
      reason: "review",
      files: ["../a", "../b"],
      globs: [`../${literal}/*.html`],
    }),
  );
  const capture = services();
  const result = generateReport(
    { cwd: root, output: "café/new.html" },
    filesystemPorts,
    metadata,
    capture.ports,
  );
  expect(result.report.errors.at(-1)?.code).toBe("REPORT_INPUT_COLLISION");
  expect(capture.written).toEqual([]);
});

it.each([
  {
    name: "relative literal alias",
    absolute: false,
    alias: true,
    tail: "new.html",
    output: "new.html",
    collision: true,
  },
  {
    name: "absolute literal alias",
    absolute: true,
    alias: true,
    tail: "new.html",
    output: "new.html",
    collision: true,
  },
  {
    name: "wildcard alias",
    absolute: false,
    alias: true,
    tail: "*.html",
    output: "new.html",
    collision: true,
  },
  {
    name: "literal without alias",
    absolute: false,
    alias: false,
    tail: "new.html",
    output: "new.html",
    collision: true,
  },
  {
    name: "relative missing parents",
    absolute: false,
    alias: true,
    tail: "missing/child/new.html",
    output: "missing/child/new.html",
    collision: true,
  },
  {
    name: "absolute missing parents",
    absolute: true,
    alias: true,
    tail: "missing/child/new.html",
    output: "missing/child/new.html",
    collision: true,
  },
  {
    name: "missing parents before wildcard",
    absolute: false,
    alias: true,
    tail: "missing/child/*.html",
    output: "missing/child/new.html",
    collision: true,
  },
  {
    name: "relative cancelled missing parent",
    absolute: false,
    alias: true,
    tail: "missing/../new.html",
    output: "new.html",
    collision: true,
  },
  {
    name: "absolute cancelled missing parents",
    absolute: true,
    alias: true,
    tail: "missing/child/../../new.html",
    output: "new.html",
    collision: true,
  },
  {
    name: "literal metacharacters",
    absolute: false,
    alias: true,
    tail: "[[]x[]][?].html",
    output: "[x]?.html",
    collision: true,
  },
  {
    name: "literal case mismatch",
    absolute: false,
    alias: true,
    tail: "New.html",
    output: "new.html",
    collision: false,
  },
  {
    name: "wildcard case mismatch",
    absolute: false,
    alias: true,
    tail: "*.HTML",
    output: "new.html",
    collision: false,
  },
  {
    name: "parent case mismatch",
    absolute: false,
    alias: true,
    tail: "new.html",
    output: "new.html",
    collision: false,
    uppercase: true,
  },
  {
    name: "unrelated literal",
    absolute: false,
    alias: true,
    tail: "different.html",
    output: "new.html",
    collision: false,
  },
])(
  "protects prospective report writes across native prefixes: $name",
  ({ absolute, alias, tail, output, collision, uppercase }) => {
    const root = realpathSync.native(fixture());
    const parent = join(root, "café");
    mkdirSync(parent);
    const nativeAlias = join(root, "cafe\u0301");
    const name = uppercase ? "CAFÉ" : alias && existsSync(nativeAlias) ? "cafe\u0301" : "café";
    if (existsSync(nativeAlias)) {
      expect(statSync(nativeAlias).ino).toBe(statSync(parent).ino);
      expect(realpathSync.native(nativeAlias)).toBe(realpathSync.native(parent));
    }
    const escape = (path: string) =>
      path.replaceAll("\\", "/").replace(/[*?[\]{}()]/gu, (c) => `[${c}]`);
    const pattern = `${absolute ? escape(join(root, name)) : `../${name}`}/${tail}`;
    const file = join(root, ".crosslink/valid.json");
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        name: "prospective",
        reason: "review",
        files: ["../a", "../b"],
        globs: [pattern],
      }),
    );
    const before = [file, join(root, "a"), join(root, "b")].map((path) => readFileSync(path));
    const target = join(parent, output);
    let writes = 0;
    const result = generateReport(
      { cwd: root, files: [file], output: target },
      filesystemPorts,
      metadata,
      {
        now: () => "2026-11-17T00:00:00Z",
        render: renderHtmlReport,
        writeNew: (path, html) => {
          writes++;
          writeFileSync(path, html, { flag: "wx" });
        },
      },
    );
    expect(result.code).toBe(2);
    expect(result.report.errors.some((error) => error.code === "REPORT_INPUT_COLLISION")).toBe(
      collision,
    );
    expect(writes).toBe(collision ? 0 : 1);
    expect(existsSync(target)).toBe(!collision);
    expect([file, join(root, "a"), join(root, "b")].map((path) => readFileSync(path))).toEqual(
      before,
    );
    expect(result.report.messages.some((message) => message.startsWith("HTML report saved:"))).toBe(
      !collision,
    );
  },
);

const definitionFailures = ["ENOENT", "EACCES"].flatMap((failure) =>
  [false, true].flatMap((dynamic) =>
    [false, true].map((baseline) => ({ failure, dynamic, baseline })),
  ),
);
it.for(definitionFailures)(
  "keeps collected membership unverified after final definition $failure (dynamic=$dynamic, baseline=$baseline)",
  ({ failure, dynamic, baseline }, context) => {
    if (failure === "EACCES" && process.platform === "win32") context.skip();
    const root = fixture(),
      file = join(root, ".crosslink/valid.json");
    if (dynamic)
      writeFileSync(
        file,
        JSON.stringify({
          version: 2,
          name: "valid",
          reason: "理由",
          files: ["../a"],
          globs: ["../[bc]"],
        }),
      );
    if (baseline) {
      const before = inspectGroup(file, filesystemPorts, defaults);
      confirmGroups([file], new Map([[file, before.snapshot!]]), filesystemPorts, defaults);
    }
    if (dynamic) {
      rmSync(join(root, "b"));
      writeFileSync(join(root, "c"), "same content at another path");
    }
    const raw = readFileSync(file),
      mode = statSync(file).mode & 0o777;
    for (const operation of ["report", "check", "related"]) {
      let injected = false,
        observed: string | undefined,
        html = "";
      const ports = {
        ...filesystemPorts,
        groups: {
          ...filesystemPorts.groups,
          readRaw: (target: string) => {
            try {
              return filesystemPorts.groups.readRaw(target);
            } catch (error) {
              observed = (error as NodeJS.ErrnoException).code;
              throw error;
            }
          },
        },
        files: {
          ...filesystemPorts.files,
          hash: (target: string) => {
            const value = filesystemPorts.files.hash(target);
            if (!injected) {
              injected = true;
              if (failure === "ENOENT") rmSync(file);
              else chmodSync(file, 0);
              expect(() => readFileSync(file)).toThrow(expect.objectContaining({ code: failure }));
            }
            return value;
          },
        },
      };
      let result;
      try {
        result = run(
          [
            operation,
            ...(operation === "report"
              ? ["--format", "html", "--output", "report.html"]
              : operation === "related"
                ? ["a"]
                : []),
            "--file",
            file,
          ],
          root,
          ports,
          metadata,
          {
            now: () => "2026-11-17T00:00:00Z",
            render: (model) => {
              html = renderHtmlReport(model);
              return html;
            },
            writeNew: (target, contents) => writeFileSync(target, contents, { flag: "wx" }),
          },
        );
      } finally {
        if (failure === "ENOENT") writeFileSync(file, raw, { mode });
        else chmodSync(file, mode);
      }
      expect(readFileSync(file)).toEqual(raw);
      expect(statSync(file).mode & 0o777).toBe(mode);
      expect(injected).toBe(true);
      expect(observed).toBe(failure);
      expect(result!.code).toBe(2);
      const group = result!.report.groups[0]!;
      expect(group.reason).toBe("理由");
      expect(group.files.map((member) => member.path)).toEqual(
        dynamic ? ["../a", "../c"] : ["../a", "../b"],
      );
      expect(group.snapshot).toBeNull();
      expect(group.errors.map((error) => error.code)).toEqual(["IO_ERROR"]);
      expect(JSON.parse(JSON.stringify(group))).toMatchObject({ definitionVerified: false });
      if (dynamic) {
        expect(group.membershipComplete).toBe(true);
        expect(group.added).toBeNull();
        expect(group.removed).toBeNull();
      }
      const text = human(result!.report, root, true);
      expect(text).toContain(
        "Management definition could not be verified; current member list may be incomplete.",
      );
      expect(text).not.toMatch(/  (Added|Removed):/);
      if (operation === "report") {
        const index = html.slice(html.indexOf('<section id="files"'));
        expect(index).toContain("2 member paths collected");
        expect(index).toContain("total member file count is unknown");
        expect(index).toContain("run check again, and regenerate");
        expect(index).not.toContain("All 2");
        expect(html).toContain('href="#files">File index (2 found, incomplete)');
        expect(html).toContain("Collected member files (2, incomplete)");
        if (dynamic) {
          expect(html).toContain("Membership comparison unavailable");
          expect(html).not.toContain("No baseline for membership comparison");
          expect(html).not.toContain('class="badge added"');
          expect(html).not.toContain("Removed since last confirmation (");
        }
      }
    }
  },
);

it("protects prospective outputs selected only by target globs including parent aliases", () => {
  const root = fixture(),
    file = join(root, ".crosslink/valid.json");
  mkdirSync(join(root, "targets"));
  writeFileSync(join(root, "targets/keep.html"), "target");
  writeFileSync(
    file,
    JSON.stringify({
      version: 3,
      name: "directional",
      reason: "impact",
      files: ["../a"],
      globs: ["../targets/**/*.html"],
      roles: { files: { "../a": "source-only" }, globs: { "../targets/**/*.html": "target-only" } },
    }),
  );
  if (process.platform !== "win32")
    symlinkSync(join(root, "targets"), join(root, "target-alias"), "dir");
  for (const output of [
    "targets/new.html",
    "targets/not-created/new.html",
    ...(process.platform === "win32"
      ? []
      : ["target-alias/new.html", "target-alias/not-created/new.html"]),
  ]) {
    const capture = services();
    const before = readFileSync(file, "utf8");
    const result = generateReport({ cwd: root, output }, filesystemPorts, metadata, capture.ports);
    expect(result.code, output).toBe(2);
    expect(
      result.report.errors.some((e) => e.code === "REPORT_INPUT_COLLISION"),
      output,
    ).toBe(true);
    expect(capture.written).toEqual([]);
    expect(existsSync(join(root, output))).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(before);
  }
});
