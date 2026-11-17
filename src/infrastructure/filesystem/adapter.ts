import { matchesGlobPath } from "../../domain/glob.js";
import { existsSync, readFileSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, posix, resolve, sep } from "node:path";
import type { CrosslinkPorts } from "../../application/ports.js";
import { canonicalGlobPattern, expandGlob } from "./glob-members.js";
import { digest, hashFile } from "./content-hash.js";
import { saveGroup, withLocks } from "./group-storage.js";
import { isManagementFile, readGroup } from "./management-file.js";
import { findGroups, groupFile, loadSettings } from "./settings.js";

function canonical(file: string): string {
  file = resolve(file);
  try {
    return realpathSync.native(file);
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    const parent = dirname(file);
    return parent === file ? file : join(canonical(parent), basename(file));
  }
}

export const filesystemPorts: CrosslinkPorts = {
  groups: {
    read: readGroup,
    readRaw: (file) => readFileSync(file, "utf8"),
    exists: existsSync,
    write: saveGroup,
    delete: unlinkSync,
    withLocks,
  },
  files: {
    expandGlob,
    matchesGlob: (file, pattern, cwd) => {
      if (
        matchesGlobPath(
          (isAbsolute(pattern) ? resolve(file) : relative(cwd, file)).split(sep).join("/"),
          posix.normalize(pattern.replaceAll("\\", "/")),
        )
      )
        return true;
      const canonicalPattern = canonicalGlobPattern(pattern, cwd);
      return (
        canonicalPattern !== undefined &&
        matchesGlobPath(canonical(file).split(sep).join("/"), canonicalPattern)
      );
    },
    isManagementFile,
    hash: hashFile,
    info: (file) => {
      const stat = statSync(file);
      return {
        isFile: stat.isFile(),
        identity: realpathSync.native(file),
      };
    },
    canonical,
  },
  configuration: { load: loadSettings, findGroups, groupFile },
  digest,
};
