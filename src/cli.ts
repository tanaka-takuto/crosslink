#!/usr/bin/env node
import { human, run } from "./commands.js";

const args = process.argv.slice(2);
const result = run(args, process.cwd());
if (args.slice(0, args.indexOf("--") < 0 ? args.length : args.indexOf("--")).includes("--json"))
  process.stdout.write(JSON.stringify(result.report, null, 2) + "\n");
else {
  process.stdout.write(human(result.report, process.cwd()));
  for (const error of result.report.errors)
    process.stderr.write(`${error.code}: ${error.message}\n`);
}
process.exitCode = result.code;
