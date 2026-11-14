import { applicationMetadata } from "./infrastructure/version-reader.js";
import { filesystemPorts } from "./infrastructure/filesystem/adapter.js";
import { run as runCommand, type RunResult } from "./interfaces/cli/commands.js";

export { human } from "./interfaces/cli/output.js";

export function run(args: string[], cwd: string): RunResult {
  return runCommand(args, cwd, filesystemPorts, applicationMetadata);
}
