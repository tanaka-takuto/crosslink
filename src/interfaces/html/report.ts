import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Inspection } from "../../application/inspect-group.js";
import type { HtmlReport } from "../../application/report.js";
import type { Problem } from "../../domain/errors.js";
import { behavior, styles } from "./report-assets.js";

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function state(group: Inspection): string {
  return group.errors.length
    ? "Inspection error"
    : group.status === "confirmed"
      ? "Confirmed"
      : "Unconfirmed";
}
function stateClass(group: Inspection): string {
  return group.errors.length ? "invalid" : group.status;
}
function badge(text: string, kind = ""): string {
  return `<span class="badge ${kind}">${escape(text)}</span>`;
}
function copy(path: string): string {
  const safe = escape(path);
  return `<span class="copy"><button type="button" data-copy="${safe}" aria-label="Copy path: ${safe}">Copy path</button><input type="text" value="${safe}" readonly hidden aria-label="Path to select and copy"><span class="copy-feedback" data-copy-feedback role="status"></span></span>`;
}
function local(path: string): string {
  return `<div class="path-actions"><a href="${escape(pathToFileURL(path).href)}">Open local file</a>${copy(path)}</div>`;
}
function diagnostics(errors: Problem[], heading: string): string {
  return errors.length
    ? `<div class="errors"><h3>${escape(heading)}</h3><ul>${errors.map((error) => `<li><strong>${escape(error.code)}</strong>: ${escape(error.message)}</li>`).join("")}</ul></div>`
    : "";
}
function comparison(file: Inspection["files"][number]): string {
  if (file.hash === null) return badge("Unreadable", "unreadable");
  if (file.changed === null) return badge("No baseline");
  return file.changed ? badge("Changed", "changed") : badge("Unchanged");
}

export function renderHtmlReport(report: HtmlReport): string {
  const { groups, errors } = report.inspection;
  const invalid = groups.filter((group) => group.errors.length).length;
  const confirmed = groups.filter(
    (group) => !group.errors.length && group.status === "confirmed",
  ).length;
  const unconfirmed = groups.length - invalid - confirmed;
  const members = new Map<string, { id: string; groups: number[] }>();
  for (const [index, group] of groups.entries()) {
    for (const member of group.files) {
      const path = resolve(dirname(group.file), member.path);
      if (!members.has(path)) members.set(path, { id: `file-${members.size + 1}`, groups: [] });
      const entry = members.get(path)!;
      if (!entry.groups.includes(index)) entry.groups.push(index);
    }
  }
  const cards = groups
    .map((group, index) => {
      const search = [
        group.name,
        group.reason,
        group.file,
        ...group.files.flatMap((file) => [file.path, resolve(dirname(group.file), file.path)]),
      ].join("\n");
      return `<article id="group-${index + 1}" class="card" tabindex="-1" data-group data-attention="${Boolean(group.errors.length || group.status === "unconfirmed")}" data-search="${escape(search)}">
<div class="card-head"><h3>${escape(group.name)}</h3>${badge(state(group), stateClass(group))}</div>
<p class="label">Reason to review together</p><p class="reason">${escape(group.reason || "Reason unavailable.")}</p>
<p class="label">Management file</p><code class="path">${escape(group.file)}</code>${local(group.file)}
<p class="muted"><small>Local links may be blocked by your browser or unavailable on another computer. Use the adjacent Copy path button or select the displayed path.</small></p>
${diagnostics(group.errors, "Inspection errors")}
<p class="label">All member files (${group.files.length})</p>
${
  group.files.length
    ? `<ul class="members">${group.files
        .map((file) => {
          const path = resolve(dirname(group.file), file.path);
          return `<li class="member"><div><a data-internal href="#${members.get(path)!.id}"><code>${escape(file.path)}</code></a><small class="path">${escape(path)}</small></div>${comparison(file)}</li>`;
        })
        .join("")}</ul>`
    : `<p class="muted">${group.reason ? "No registered member files." : "Member list unavailable."}</p>`
}
</article>`;
    })
    .join("\n");
  const fileCards = [...members]
    .map(
      ([path, entry]) => `<article id="${entry.id}" class="card" tabindex="-1">
<h3 class="path">${escape(path)}</h3>${local(path)}<p>${entry.groups.length} direct ${entry.groups.length === 1 ? "group" : "groups"} in this scope</p>
<ul class="direct">${entry.groups
        .map((index) => {
          const group = groups[index]!;
          return `<li><a data-internal href="#group-${index + 1}">${escape(group.name)}</a> ${badge(state(group), stateClass(group))}<code class="path">${escape(group.file)}</code></li>`;
        })
        .join("")}</ul></article>`,
    )
    .join("\n");
  const scope = report.scope;
  const scopeDescription = scope.selection
    ? "Selected management files"
    : "Discovered management files";
  const cspHash = (source: string) => createHash("sha256").update(source).digest("base64");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${cspHash(behavior)}'; style-src 'sha256-${cspHash(styles)}'; base-uri 'none'; form-action 'none'">
<title>crosslink — Review report</title><style>${styles}</style></head>
<body><a class="skip" href="#groups">Skip to groups</a>
<header><div class="wrap"><p class="eyebrow">crosslink / Review report</p><h1>Related files. Review context.</h1>
<p><span class="snapshot">Snapshot</span><time datetime="${escape(report.generatedAt)}">${escape(report.generatedAt)}</time> · crosslink ${escape(report.applicationVersion)}</p>
<p class="notice">This is a saved snapshot, not a live view. Regenerate the report after changes.<br>Confirmed means the inspected content matches a recorded confirmation; it does not guarantee semantic correctness.</p>
<nav class="nav" aria-label="Report sections"><a href="#groups">Groups (${groups.length})</a><a href="#files">File index (${members.size})</a><a href="#scope">Inspection scope</a></nav></div></header>
<main class="wrap">
<div class="stats" aria-label="Inspection summary"><div class="stat" data-total="${groups.length}"><strong>${groups.length}</strong><span>Total groups${scope.complete ? "" : " found before failure"}</span></div><div class="stat" data-confirmed="${confirmed}"><strong>${confirmed}</strong><span>Confirmed</span></div><div class="stat" data-unconfirmed="${unconfirmed}"><strong>${unconfirmed}</strong><span>Unconfirmed</span></div><div class="stat" data-invalid="${invalid}"><strong>${invalid}</strong><span>Groups with errors</span></div></div>
<section class="scope" id="scope"><details><summary>Inspection scope and snapshot details</summary><dl><dt>Working directory</dt><dd class="path">${escape(scope.cwd)}</dd><dt>Selection</dt><dd>${scopeDescription}${scope.selection ? `<ul>${scope.selection.map((path) => `<li class="path">${escape(path)}</li>`).join("")}</ul>` : " under the working directory, excluding .git, node_modules and directory symlinks."}</dd><dt>Configuration path</dt><dd class="path">${escape(scope.configuration)}</dd><dt>Inspection completed</dt><dd>${scope.complete ? "Yes. Individual group errors are listed separately." : "No. The target scope could not be fully inspected."}</dd></dl></details></section>
${!scope.complete ? `<div class="errors"><h2>Inspection incomplete</h2><p>These totals do not describe the full target scope.</p></div>` : ""}
${errors.length ? `<div class="errors"><h2>${errors.length} inspection ${errors.length === 1 ? "error" : "errors"}</h2><p>Errors are separate from confirmation status.${invalid ? " See the affected groups below." : ""}</p>${!scope.complete ? diagnostics(errors, "Diagnostics") : ""}</div>` : ""}
<section id="groups" tabindex="-1" aria-labelledby="groups-heading"><h2 id="groups-heading">Groups</h2>
<div class="toolbar"><div class="search"><label for="search">Search groups</label><input type="search" id="search" placeholder="Name, reason or file path" aria-describedby="search-help"></div><label class="check"><input type="checkbox" id="attention">Needs attention</label><button type="button" id="reset">Clear filters</button><small id="search-help">Search names, reasons and paths. Needs attention includes unconfirmed groups and inspection errors.</small></div>
<noscript><p class="notice">JavaScript is disabled. All groups and links remain readable; use your browser's Find command. Select a displayed path to copy it.</p></noscript>
<p class="count" id="shown" role="status">${groups.length} of ${groups.length} groups shown.</p>
<p class="legend">Changed / Unchanged compare content with the last confirmation. No baseline means no confirmation to compare. Unreadable means a file could not be inspected. Group confirmation also depends on the group definition.</p>
${groups.length ? `<div class="cards">${cards}</div>` : `<div class="empty">${scope.complete ? "No registered groups." : "No groups could be inspected. Resolve the inspection error and regenerate."}</div>`}</section>
<section id="files" class="file-section" tabindex="-1" aria-labelledby="files-heading"><h2 id="files-heading">File index</h2><p class="muted">All ${members.size} member files in this scope. Group filters above do not hide this index. Links list direct memberships only; they do not propagate confirmation.</p>
<p class="notice">Local links point to the original absolute paths and may not open on another computer or in every browser. Use Copy path, or select the displayed path if clipboard access is unavailable.</p>
${members.size ? `<div class="cards">${fileCards}</div>` : `<p class="empty">No member files available in this scope.</p>`}</section>
<footer>Read-only report · No file contents or diffs are embedded. Files and confirmation records are not updated by this report. <a href="#groups">Back to groups</a></footer>
</main><script>${behavior}</script></body></html>\n`;
}
