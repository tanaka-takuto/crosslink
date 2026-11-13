import { filesystemPorts } from "./infrastructure/filesystem/adapter.js";
import { run as runCommand, type RunResult } from "./interfaces/cli/commands.js";

export { human } from "./interfaces/cli/commands.js";

export function run(args: string[], cwd: string): RunResult {
  return runCommand(args, cwd, filesystemPorts);
}
