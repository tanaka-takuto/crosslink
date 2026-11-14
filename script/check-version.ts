import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

// SemVer 2.0.0の識別子規則を文字列として検査し、巨大な数値も丸めない。
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function validateVersion(value: unknown, base?: string): string {
  const pkg = value as { version?: unknown; private?: unknown } | null;
  const version = pkg?.version;
  // JavaScriptの $ は末尾改行の直前にも一致するため、一致全体の長さも確認する。
  if (typeof version !== "string" || version.match(semver)?.[0] !== version) {
    throw new Error("package.json version must use SemVer 2.0.0 format");
  }
  if (pkg?.private !== true) throw new Error("package.json private must remain true");
  if (version === base) throw new Error("package.json version must differ from the base version");
  return version;
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    let base: string | undefined;
    if (args.length > 0) {
      if (args.length !== 2 || args[0] !== "--base" || !/^[a-f0-9]{40}$/.test(args[1] ?? "")) {
        throw new Error("Usage: check-version.ts [--base <40-character commit SHA>]");
      }
      const source = execFileSync("git", ["show", `${args[1]}:package.json`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const pkg = JSON.parse(source) as { version?: unknown };
      if (typeof pkg.version !== "string") throw new Error("Base package.json has no version");
      base = pkg.version;
    }
    const version = validateVersion(JSON.parse(readFileSync("package.json", "utf8")), base);
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
    console.log(`Version policy passed: ${version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
