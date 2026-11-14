import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

function git(args, cwd, env = process.env) {
  const result = spawnSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      result.error?.message ?? result.stderr ?? "Cannot read staged content from Git.",
    );
  return result.stdout;
}

function toolEntry(root, name, command = name) {
  try {
    const require = createRequire(join(root, "package.json"));
    const manifest = require.resolve(`${name}/package.json`);
    const { bin } = JSON.parse(readFileSync(manifest, "utf8"));
    return resolve(dirname(manifest), typeof bin === "string" ? bin : bin[command]);
  } catch {
    throw new Error("Development dependencies are required. Run pnpm install --frozen-lockfile.");
  }
}

function node(entry, args, cwd) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status === null)
    throw new Error(result.error?.message ?? "Cannot start the inspection process.");
  return result;
}

function staticCheck(root, snapshot, name, args) {
  const result = node(toolEntry(root, name), args, snapshot);
  if (result.status !== 0) {
    process.stderr.write(result.stdout + result.stderr);
    throw new Error(
      `Staged ${name} check failed. Fix the files and stage them again.`,
    );
  }
  console.log(`pre-commit: ${name} passed`);
}

function diagnostics(report, snapshot) {
  for (const group of report.groups) {
    if (group.status === "confirmed" && group.errors.length === 0) continue;
    console.error(`${group.errors.length ? "Invalid" : "Unconfirmed"}: ${group.name} (${relative(snapshot, group.file)})`);
    console.error(`  Reason: ${group.reason}`);
    for (const file of group.files)
      console.error(
        `  ${file.changed === null ? "New" : file.changed ? "Changed" : "Unchanged"}: ${file.path}`,
      );
    for (const error of group.errors) console.error(`  ${error.code}: ${error.message}`);
  }
  for (const error of report.errors) console.error(`${error.code}: ${error.message}`);
}

function checkStaged() {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("pre-commit checks require Node.js 24 or later.");
  const root = git(["rev-parse", "--show-toplevel"]).replace(/\r?\n$/, "");
  const entries = git(["ls-files", "-z"], root).split("\0").filter(Boolean);
  const hasGroups = entries.some(
    (file) => file === "crosslink.config.json" || file.split("/").includes(".crosslink"),
  );
  const hasProject = entries.includes("package.json");
  // 開発プロジェクトも管理グループもない一時リポジトリは検査不要。
  if (!hasGroups && !hasProject) {
    console.log("pre-commit: crosslink: No registered groups.");
    return 0;
  }

  const snapshot = mkdtempSync(join(tmpdir(), "crosslink-index-"));
  try {
    // 作業ツリーとindexを書き換えず、ステージされた属性を使って取り出す。
    // Gitが渡す相対indexパスは、検査用work-treeへ切り替える前に絶対化する。
    const index = git(["rev-parse", "--path-format=absolute", "--git-path", "index"], root).replace(
      /\r?\n$/,
      "",
    );
    const gitDir = git(["rev-parse", "--absolute-git-dir"], root).replace(/\r?\n$/, "");
    const prefix = snapshot.replaceAll("\\", "/") + "/";
    git(
      [
        `--git-dir=${gitDir}`,
        `--work-tree=${snapshot}`,
        "checkout-index",
        "--all",
        `--prefix=${prefix}`,
      ],
      root,
      { ...process.env, GIT_INDEX_FILE: index },
    );
    if (!existsSync(join(root, "node_modules")))
      throw new Error("Development dependencies are required. Run pnpm install --frozen-lockfile.");
    const dependencies = join(snapshot, "node_modules");
    if (existsSync(dependencies))
      throw new Error("Remove node_modules from Git tracking.");
    symlinkSync(
      join(root, "node_modules"),
      dependencies,
      process.platform === "win32" ? "junction" : "dir",
    );
    // CIと同じ設定・対象に対して、書き換えずに整形とlintを検査する。
    staticCheck(root, snapshot, "oxfmt", ["--check", "."]);
    const lintTargets = ["src", "vitest.config.ts"].filter((name) =>
      existsSync(join(snapshot, name)),
    );
    if (lintTargets.length)
      staticCheck(root, snapshot, "oxlint", ["--deny-warnings", ...lintTargets]);
    if (!hasGroups) {
      console.log("pre-commit: crosslink: No registered groups.");
      return 0;
    }
    // 古い生成物は使わず、コミットされるCLIそのものを検査用にビルドする。
    const dist = join(snapshot, "dist");
    rmSync(dist, { recursive: true, force: true });
    const built = node(
      toolEntry(root, "typescript", "tsc"),
      ["--project", join(snapshot, "tsconfig.build.json"), "--outDir", dist],
      snapshot,
    );
    if (built.status !== 0) {
      process.stderr.write(built.stdout + built.stderr);
      throw new Error("Cannot build the staged CLI. Check the source and configuration.");
    }
    const checked = node(join(dist, "cli.js"), ["check", "--json"], snapshot);
    let report;
    try {
      report = JSON.parse(checked.stdout);
      if (!Array.isArray(report.groups) || !Array.isArray(report.errors)) throw new Error();
    } catch {
      process.stderr.write(checked.stdout + checked.stderr);
      throw new Error("Cannot obtain an inspection report from the staged CLI.");
    }
    if (checked.status !== 0) {
      diagnostics(report, snapshot);
      console.error(
        "pre-commit: Staged crosslink check failed. Stage the confirmation records with git add too.",
      );
      return checked.status;
    }
    if (
      report.result !== "ok" ||
      report.errors.length ||
      report.groups.some((group) => group.status !== "confirmed" || group.errors.length)
    )
      throw new Error("CLI exit code does not match the inspection report.");
    console.log(
      report.groups.length
        ? `pre-commit: crosslink: ${report.groups.length} groups confirmed`
        : "pre-commit: crosslink: No registered groups.",
    );
    return 0;
  } finally {
    rmSync(snapshot, { recursive: true, force: true, maxRetries: 3 });
  }
}

try {
  process.exitCode = checkStaged();
} catch (error) {
  console.error(`pre-commit: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
