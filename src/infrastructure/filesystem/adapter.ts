import { existsSync, readFileSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { CrosslinkPorts } from "../../application/ports.js";
import { digest, hashFile } from "./content-hash.js";
import { saveGroup, withLocks } from "./group-storage.js";
import { isManagementFile, readGroup } from "./management-file.js";
import { findGroups, groupFile, loadSettings } from "./settings.js";

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
    isManagementFile,
    hash: hashFile,
    info: (file) => ({ isFile: statSync(file).isFile(), identity: realpathSync(file) }),
    canonical: (file) => (existsSync(file) ? realpathSync(file) : resolve(file)),
  },
  configuration: { load: loadSettings, findGroups, groupFile },
  digest,
};
