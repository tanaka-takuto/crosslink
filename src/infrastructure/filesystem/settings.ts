import type { Settings } from "../../application/ports.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { CrosslinkError } from "../../domain/errors.js";

export const defaults: Settings = { directoryName: ".crosslink", fileNameTemplate: "{name}.json" };

function safeName(name: string): boolean {
  return (
    Boolean(name.trim()) &&
    name !== "." &&
    name !== ".." &&
    !/[<>:"/\\|?*]/.test(name) &&
    !Array.from(name).some((character) => character.charCodeAt(0) < 32) &&
    !/[. ]$/.test(name) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
  );
}

export function loadSettings(cwd: string, config?: string): Settings {
  const file = resolve(cwd, config ?? "crosslink.config.json");
  if (!config && !existsSync(file)) return { ...defaults };
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CrosslinkError("INVALID_CONFIG", "Configuration must be a JSON object.");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !["directoryName", "fileNameTemplate"].includes(key)))
    throw new CrosslinkError("INVALID_CONFIG", "Unsupported configuration fields.");
  const directoryName = data.directoryName ?? defaults.directoryName;
  const fileNameTemplate = data.fileNameTemplate ?? defaults.fileNameTemplate;
  if (typeof directoryName !== "string" || !safeName(directoryName))
    throw new CrosslinkError("INVALID_CONFIG", "directoryName must be a single directory name.");
  if (
    typeof fileNameTemplate !== "string" ||
    fileNameTemplate.split("{name}").length !== 2 ||
    !fileNameTemplate.endsWith(".json") ||
    !safeName(fileNameTemplate.replace("{name}", "group"))
  )
    throw new CrosslinkError(
      "INVALID_CONFIG",
      "fileNameTemplate must be a JSON filename containing exactly one {name}.",
    );
  return { directoryName, fileNameTemplate };
}

export function groupFile(name: string, cwd: string, settings: Settings): string {
  const filename = settings.fileNameTemplate.replace("{name}", name);
  if (!safeName(filename))
    throw new CrosslinkError(
      "INVALID_NAME",
      "Cannot create a safe filename from this name. Specify a destination with --file.",
    );
  return resolve(cwd, settings.directoryName, filename);
}

export function findGroups(cwd: string, settings: Settings): string[] {
  const files: string[] = [];
  function visit(directory: string, storage: boolean): void {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visit(file, storage || entry.name === settings.directoryName);
      else if (entry.isFile() && storage && entry.name.endsWith(".json")) files.push(resolve(file));
      else if (
        entry.isSymbolicLink() &&
        (entry.name === settings.directoryName || (storage && entry.name.endsWith(".json")))
      )
        throw new CrosslinkError(
          "MANAGEMENT_SYMLINK",
          `Symbolic links to management files or directories are not supported: ${file}`,
        );
    }
  }
  visit(resolve(cwd), resolve(cwd).split(sep).includes(settings.directoryName));
  return files.sort();
}
