import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";

function git(args, cwd, env = process.env, encoding = "utf8") {
  const result = spawnSync("git", args, {
    cwd,
    env,
    encoding,
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

// 動的グループは、全参照をindexツリー内で再現できる場合だけ検査する。
// 既存の静的グループに対する外部参照契約はここでは変更しない。
function validateStagedReferences(report, snapshot, staged) {
  const canonicalSnapshot = realpathSync.native(snapshot);
  const inside = (target, base = snapshot) => {
    const path = relative(base, target);
    return path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path);
  };
  for (const group of report.groups) {
    if (!group.globs?.length) continue;
    const reject = (reference) => {
      const path = relative(snapshot, resolve(dirname(group.file), reference)).split(sep).join("/");
      throw new Error(`STAGED_REFERENCE_UNSUPPORTED: Cannot reproduce reference in the index tree: ${reference} (${relative(snapshot, group.file)}; index mode ${staged.get(path)?.mode ?? "not staged"}). Use repository-relative selectors and files whose targets remain inside the repository, then inspect and confirm again.`);
    };
    for (const pattern of group.globs) {
      const portable = pattern.replaceAll("\\", "/");
      if (isAbsolute(portable) || win32.isAbsolute(portable)) reject(pattern);
      let depth = relative(snapshot, dirname(group.file)).split(sep).filter(Boolean).length;
      for (const part of portable.split("/")) {
        if (!part || part === "." || part === "**") continue;
        depth += part === ".." ? -1 : 1;
        if (depth < 0) reject(pattern);
      }
    }
    for (const member of group.files) {
      const target = resolve(dirname(group.file), member.path);
      if (isAbsolute(member.path) || win32.isAbsolute(member.path) || !inside(target)) reject(member.path);
      if (existsSync(target) && !inside(realpathSync.native(target), canonicalSnapshot)) reject(member.path);
    }
  }
}

function checkStaged() {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("pre-commit checks require Node.js 24 or later.");
  const root = git(["rev-parse", "--show-toplevel"]).replace(/\r?\n$/, "");
  const staged = new Map(git(["ls-files", "--stage", "-z"], root).split("\0").filter(Boolean).map((entry) => {
    const tab = entry.indexOf("\t"), [mode, oid, stage] = entry.slice(0, tab).split(" ");
    if (tab === -1 || stage !== "0") throw new Error("Cannot inspect an unmerged index. Resolve and stage conflicts first.");
    return [entry.slice(tab + 1), { mode, oid }];
  }));
  const entries = [...staged.keys()];
  const hasGroups = entries.some(
    (file) => file === "crosslink.config.json" || file.split("/").includes(".crosslink"),
  );
  const hasProject = entries.includes("package.json");
  // 開発プロジェクトも管理グループもない一時リポジトリは検査不要。
  if (!hasGroups && !hasProject) {
    console.log("pre-commit: crosslink: No registered groups.");
    return 0;
  }

  const temporary = mkdtempSync(join(tmpdir(), "crosslink-index-"));
  const tree = join(temporary, "tree");
  mkdirSync(tree);
  const snapshot = realpathSync(tree);
  try {
    // 作業ツリーとindexを書き換えず、ステージされた属性を使って取り出す。
    // Gitが渡す相対indexパスは、検査用work-treeへ切り替える前に絶対化する。
    const index = git(["rev-parse", "--path-format=absolute", "--git-path", "index"], root).replace(
      /\r?\n$/,
      "",
    );
    const gitDir = git(["rev-parse", "--absolute-git-dir"], root).replace(/\r?\n$/, "");
    const prefix = snapshot.replaceAll("\\", "/") + "/";
    const links = [...staged].filter(([, entry]) => entry.mode === "120000");
    try {
      git(
        [
          "-c", "core.symlinks=true",
          `--git-dir=${gitDir}`,
          `--work-tree=${snapshot}`,
          "checkout-index",
          "--all",
          `--prefix=${prefix}`,
        ],
        root,
        { ...process.env, GIT_INDEX_FILE: index },
      );
    } catch (error) {
      if (!links.length) throw error;
      throw new Error(`STAGED_REFERENCE_UNSUPPORTED: Cannot materialize index mode 120000 symlinks with core.symlinks=true: ${links.map(([path, entry]) => `${path} (blob ${entry.oid})`).join(", ")}. ${error.message}`);
    }
    // core.symlinks=falseの通常ファイルを、リンク先の本文として検査してはならない。
    for (const [path, entry] of links) {
      try {
        const file = join(snapshot, path);
        if (!lstatSync(file).isSymbolicLink()) throw new Error("Checkout is not a symbolic link.");
        const expected = git(["cat-file", "blob", entry.oid], root, process.env, null);
        if (!expected.length || expected.includes(0)) throw new Error("Index link target is empty or contains NUL.");
        const actual = readlinkSync(file, { encoding: "buffer" });
        let same = actual.equals(expected);
        if (process.platform === "win32") {
          // Git/Win32の区切りやabsolute表現の差は許すが、異なるtargetには置き換えない。
          const target = (bytes) => {
            const text = bytes.toString("utf8");
            if (!Buffer.from(text).equals(bytes)) throw new Error("Index link target is not valid UTF-8.");
            const absolute = resolve(dirname(file), text);
            try { return realpathSync.native(absolute); }
            catch (error) {
              if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
              return win32.toNamespacedPath(absolute);
            }
          };
          same = target(actual) === target(expected);
        }
        if (!same) throw new Error("Checkout link target differs from its index blob.");
      } catch (error) {
        throw new Error(`STAGED_REFERENCE_UNSUPPORTED: Cannot reproduce ${path} (index mode ${entry.mode}, blob ${entry.oid}). ${error.message}`);
      }
    }
    if (!existsSync(join(root, "node_modules")))
      throw new Error("Development dependencies are required. Run pnpm install --frozen-lockfile.");
    const dependencies = join(snapshot, "node_modules");
    const injected = !existsSync(dependencies);
    if (injected) symlinkSync(
      join(root, "node_modules"), dependencies,
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
    const runtime = join(temporary, "runtime");
    mkdirSync(runtime);
    copyFileSync(join(snapshot, "package.json"), join(runtime, "package.json"));
    const dist = join(runtime, "dist");
    const built = node(
      toolEntry(root, "typescript", "tsc"),
      ["--project", join(snapshot, "tsconfig.build.json"), "--outDir", dist, "--typeRoots", join(root, "node_modules/@types")],
      snapshot,
    );
    if (built.status !== 0) {
      process.stderr.write(built.stdout + built.stderr);
      throw new Error("Cannot build the staged CLI. Check the source and configuration.");
    }
    if (injected) unlinkSync(dependencies);
    const checked = node(join(dist, "cli.js"), ["check", "--json"], snapshot);
    let report;
    try {
      report = JSON.parse(checked.stdout);
      if (!Array.isArray(report.groups) || !Array.isArray(report.errors)) throw new Error();
    } catch {
      process.stderr.write(checked.stdout + checked.stderr);
      throw new Error("Cannot obtain an inspection report from the staged CLI.");
    }
    validateStagedReferences(report, snapshot, staged);
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
    rmSync(temporary, { recursive: true, force: true, maxRetries: 3 });
  }
}

try {
  process.exitCode = checkStaged();
} catch (error) {
  console.error(`pre-commit: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
