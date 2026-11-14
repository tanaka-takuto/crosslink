import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import type { Inspection } from "../../application/inspect-group.js";
import type { HtmlReport } from "../../application/report.js";
import { inspectionReport } from "../../application/inspection-report.js";
import { renderHtmlReport } from "./report.js";

const root = resolve("fixture-html");
function group(changes: Partial<Inspection> = {}): Inspection {
  return {
    file: resolve(root, ".crosslink/one.json"),
    name: "同名グループ",
    reason: "A・Bの理由",
    status: "unconfirmed",
    files: [
      { path: "../a", hash: "aaa", changed: false },
      { path: "../shared b", hash: "bbb", changed: true },
    ],
    snapshot: "snapshot",
    errors: [],
    ...changes,
  };
}
function model(groups: Inspection[] = [group()]): HtmlReport {
  return {
    inspection: inspectionReport("report", groups).report,
    generatedAt: "2026-11-14T00:00:00.000Z",
    applicationVersion: "0.4.0",
    scope: {
      cwd: root,
      selection: null,
      configuration: resolve(root, "crosslink.config.json"),
      complete: true,
    },
  };
}

it("distinguishes confirmation, inspection errors and all member comparison states", () => {
  const html = renderHtmlReport(
    model([
      group({ status: "confirmed" }),
      group({
        file: resolve(root, ".crosslink/two.json"),
        files: [{ path: "../new", hash: "c", changed: null }],
      }),
      group({
        file: resolve(root, ".crosslink/bad.json"),
        errors: [{ code: "FILE_UNREADABLE", message: "Cannot read file" }],
        files: [{ path: "../missing", hash: null, changed: true }],
      }),
    ]),
  );
  expect(html).toContain('data-total="3"');
  expect(html).toContain('data-confirmed="1"');
  expect(html).toContain('data-unconfirmed="1"');
  expect(html).toContain('data-invalid="1"');
  for (const text of [
    "Confirmed",
    "Unconfirmed",
    "Inspection error",
    "Changed",
    "Unchanged",
    "No baseline",
    "Unreadable",
    "FILE_UNREADABLE",
  ])
    expect(html).toContain(text);
  expect(html).toContain("2026-11-14T00:00:00.000Z");
  expect(html).toContain("0.4.0");
  expect(html).toContain("Snapshot");
  expect(html).toContain("does not guarantee semantic correctness");
});

it("links groups to shared files and only their direct groups with unique stable ids", () => {
  const html = renderHtmlReport(
    model([
      group(),
      group({
        file: resolve(root, ".crosslink/two.json"),
        files: [
          { path: "../shared b", hash: "bbb", changed: true },
          { path: "../c", hash: "ccc", changed: false },
        ],
      }),
      group({
        file: resolve(root, ".crosslink/three.json"),
        files: [
          { path: "../c", hash: "ccc", changed: false },
          { path: "../d", hash: "ddd", changed: false },
        ],
      }),
    ]),
  );
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  const shared = html.slice(
    html.indexOf('<article id="file-2"'),
    html.indexOf('<article id="file-3"'),
  );
  expect(shared).toContain('href="#group-1"');
  expect(shared).toContain('href="#group-2"');
  expect(shared).not.toContain('href="#group-3"');
  expect(shared).toContain("2 direct groups");
  expect(html).toContain(`href="${pathToFileURL(resolve(root, "shared b")).href}"`);
  expect(html).toContain("data-copy=");
});

it("escapes all user data without injecting it into executable script or unsafe URLs", () => {
  const attack = '</script><img src=x onerror="alert(1)">&\'日本語';
  const html = renderHtmlReport(
    model([
      group({
        name: attack,
        reason: attack,
        files: [
          { path: "../javascript:alert(1)", hash: "a", changed: null },
          { path: "../<script>.txt", hash: "b", changed: null },
        ],
      }),
    ]),
  );
  expect(html).not.toContain("<img src=x");
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain("&lt;/script&gt;&lt;img");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeTruthy();
  expect(script).not.toContain(attack);
  expect(script).not.toContain("innerHTML");
  expect(html).toContain("Content-Security-Policy");
  expect(html).not.toMatch(/<(?:script|link)[^>]+(?:src|href)="https?:/);
});

it("keeps a complete readable report without JavaScript and differentiates empty from incomplete scope", () => {
  const html = renderHtmlReport(model([]));
  expect(html).toContain("No registered groups.");
  expect(html).toContain('<label for="search"');
  expect(html).toContain("Needs attention");
  expect(html).toContain("JavaScript");
  const incomplete = model([]);
  incomplete.scope.complete = false;
  incomplete.inspection.messages = [];
  incomplete.inspection.errors = [{ code: "IO_ERROR", message: "Discovery failed" }];
  const failed = renderHtmlReport(incomplete);
  expect(failed).toContain("Inspection incomplete");
  expect(failed).toContain("Discovery failed");
  expect(failed).not.toContain("No registered groups.");
});

// ブラウザーの代用ではなく、埋込スクリプトの操作契約だけを検証する。
it("filters offline, clears filters when following a hidden group and falls back to selectable paths", async () => {
  const html = renderHtmlReport(model());
  const listeners = new Map<string, (event?: unknown) => unknown>();
  function element(fields: Record<string, unknown> = {}) {
    return {
      id: "",
      value: "",
      checked: false,
      hidden: false,
      textContent: "",
      dataset: {},
      addEventListener: (type: string, listener: (event?: unknown) => unknown) =>
        listeners.set(String(fields.id) + ":" + type, listener),
      focus() {},
      ...fields,
    };
  }
  const search = element({ id: "search" });
  const attention = element({ id: "attention" });
  const shown = element({ id: "shown" });
  const reset = element({ id: "reset" });
  const cards = [
    element({ id: "group-1", dataset: { search: "名前 理由 /path/shared", attention: "true" } }),
    element({ id: "group-2", dataset: { search: "confirmed", attention: "false" } }),
  ];
  let selected = false;
  const fallback = element({
    select: () => {
      selected = true;
    },
  });
  const feedback = element();
  const button = element({
    id: "copy",
    dataset: { copy: "/path/shared" },
    parentElement: {
      querySelector: (selector: string) => (selector === "input" ? fallback : feedback),
    },
  });
  const link = element({ id: "link", getAttribute: () => "#group-2" });
  const byId = new Map(
    [search, attention, shown, reset, ...cards].map((entry) => [String(entry.id), entry]),
  );
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1]!, {
    document: {
      querySelectorAll: (selector: string) =>
        selector === "[data-group]" ? cards : selector === "[data-copy]" ? [button] : [link],
      getElementById: (id: string) => byId.get(id),
    },
    navigator: {},
    location: { hash: "" },
  });
  search.value = "理由";
  listeners.get("search:input")!();
  expect(cards.map((card) => card.hidden)).toEqual([false, true]);
  search.value = "";
  attention.checked = true;
  listeners.get("attention:change")!();
  expect(cards.map((card) => card.hidden)).toEqual([false, true]);
  listeners.get("link:click")!();
  expect(cards[1]?.hidden).toBe(false);
  expect(attention.checked).toBe(false);
  await listeners.get("copy:click")!();
  expect(fallback.hidden).toBe(false);
  expect(selected).toBe(true);
  expect(feedback.textContent).toContain("Select");
  search.value = "absent";
  listeners.get("search:input")!();
  expect(shown.textContent).toContain("0 of 2");
  listeners.get("reset:click")!();
  expect(cards.every((card) => !card.hidden)).toBe(true);
});
