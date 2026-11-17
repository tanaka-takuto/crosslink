import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture({ project = true, groups = true } = {}) {
  const temporary = mkdtempSync(join(tmpdir(), "crosslink-precommit-"));
  roots.push(temporary);
  const root = join(temporary, "repo with space 日本語");
  mkdirSync(root);
  const globalConfig = join(temporary, "empty-git-config");
  writeFileSync(globalConfig, "");
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_AUTHOR_NAME: "Hook Test",
    GIT_AUTHOR_EMAIL: "hooks@example.invalid",
    GIT_COMMITTER_NAME: "Hook Test",
    GIT_COMMITTER_EMAIL: "hooks@example.invalid",
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
  };
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG_COUNT",
  ])
    delete env[name];
  function git(...args) {
    const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  }
  function cli(...args) {
    return spawnSync(process.execPath, [join(sourceRoot, "dist/cli.js"), ...args], {
      cwd: root,
      env,
      encoding: "utf8",
    });
  }
  function confirm() {
    const report = cli("check", "--json");
    assert.ok([0, 1].includes(report.status), report.stdout + report.stderr);
    writeFileSync(join(root, "review.json"), report.stdout);
    const result = cli("confirm", "--all", "--snapshot", "review.json");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    rmSync(join(root, "review.json"));
  }
  git("init", "--quiet", "--initial-branch=main");
  git("config", "core.hooksPath", join(sourceRoot, ".githooks").replaceAll("\\", "/"));
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(root, ".gitignore"), "node_modules\ndist\n");
  writeFileSync(join(root, "a"), "a");
  writeFileSync(join(root, "b"), "b");
  if (project) {
    cpSync(join(sourceRoot, "src"), join(root, "src"), { recursive: true });
    for (const name of [
      "package.json",
      "tsconfig.json",
      "tsconfig.build.json",
      ".oxfmtrc.json",
      ".oxlintrc.json",
      "vitest.config.ts",
    ])
      cpSync(join(sourceRoot, name), join(root, name));
    symlinkSync(
      join(sourceRoot, "node_modules"),
      join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  if (groups) {
    const created = cli("create", "pair", "a", "b", "--reason", "一緒に確認するため");
    assert.equal(created.status, 0, created.stdout + created.stderr);
    confirm();
  }
  git("add", ".");
  const commit = (...args) => {
    const result = spawnSync(
      "git",
      ["commit", "--quiet", "-m", "test(#123): フックを検証する", ...args],
      {
        cwd: root,
        env,
        encoding: "utf8",
      },
    );
    assert.equal(
      readdirSync(temporary).some((name) => name.startsWith("crosslink-index-")),
      false,
    );
    return result;
  };
  return { root, git, cli, confirm, commit, output: (result) => result.stdout + result.stderr };
}

// 実際のGitフック・CLI・整形・lintで、部分ステージの成功と拒否を確認する。
test("確認済みのindexだけをコミットし、未ステージの変更とindexを保持する", () => {
  const f = fixture();
  writeFileSync(join(f.root, "a"), "unstaged change");
  const index = f.git("ls-files", "--stage");
  const result = f.commit();
  assert.equal(result.status, 0, f.output(result));
  assert.match(f.output(result), /crosslink/);
  assert.equal(f.git("show", "HEAD:a"), "a");
  assert.equal(readFileSync(join(f.root, "a"), "utf8"), "unstaged change");
  assert.equal(f.git("ls-files", "--stage"), index);
});

test("作業ツリーが確認済みでもindexの未確認変更を拒否し、両方を保持する", () => {
  const f = fixture();
  writeFileSync(join(f.root, "a"), "staged change");
  f.git("add", "a");
  writeFileSync(join(f.root, "a"), "a");
  assert.equal(f.cli("check").status, 0);
  const index = f.git("ls-files", "--stage");
  const result = f.commit();
  assert.notEqual(result.status, 0, f.output(result));
  assert.match(f.output(result), /Unconfirmed/);
  assert.equal(readFileSync(join(f.root, "a"), "utf8"), "a");
  assert.equal(f.git("ls-files", "--stage"), index);
});

test("確認記録のステージ漏れを拒否する", () => {
  const f = fixture();
  writeFileSync(join(f.root, "a"), "changed");
  f.git("add", "a");
  f.confirm();
  assert.equal(f.cli("check").status, 0);
  const index = f.git("ls-files", "--stage");
  const record = readFileSync(join(f.root, ".crosslink/pair.json"), "utf8");
  const result = f.commit();
  assert.notEqual(result.status, 0, f.output(result));
  assert.equal(readFileSync(join(f.root, ".crosslink/pair.json"), "utf8"), record);
  assert.equal(f.git("ls-files", "--stage"), index);
});

test("変更と新しい確認記録を両方ステージすればコミットできる", () => {
  const f = fixture();
  writeFileSync(join(f.root, "a"), "changed");
  f.confirm();
  f.git("add", "a", ".crosslink/pair.json");
  const result = f.commit();
  assert.equal(result.status, 0, f.output(result));
  assert.equal(f.git("show", "HEAD:a"), "changed");
});

test("1ファイルの不正なグループを拒否する", () => {
  const f = fixture();
  assert.equal(f.cli("remove", ".crosslink/pair.json", "b").status, 0);
  f.git("add", ".crosslink/pair.json");
  const result = f.commit();
  assert.notEqual(result.status, 0, f.output(result));
  assert.match(f.output(result), /TOO_FEW_FILES/);
});

test("作業ツリーの古いdistと未ステージのCLI改変を使わない", () => {
  const f = fixture();
  writeFileSync(join(f.root, "a"), "staged change");
  f.git("add", "a");
  mkdirSync(join(f.root, "dist"));
  writeFileSync(join(f.root, "dist/cli.js"), "process.exit(0);\n");
  writeFileSync(join(f.root, "src/cli.ts"), "process.exit(0);\n");
  const result = f.commit();
  assert.notEqual(result.status, 0, f.output(result));
  assert.match(f.output(result), /Unconfirmed/);
});

test("必要な開発依存がなければ案内して失敗する", () => {
  const f = fixture();
  rmSync(join(f.root, "node_modules"));
  const result = f.commit();
  assert.notEqual(result.status, 0, f.output(result));
  assert.match(f.output(result), /pnpm install/);
});

test("グループ0件は開発依存なしでも通知して成功する", () => {
  const f = fixture({ project: false, groups: false });
  const result = f.commit();
  assert.equal(result.status, 0, f.output(result));
  assert.match(f.output(result), /No registered groups/);
});

test("壊れた設定をグループ0件と誤認せず拒否する", () => {
  const f = fixture({ groups: false });
  writeFileSync(join(f.root, "crosslink.config.json"), "{");
  f.git("add", "crosslink.config.json");
  const result = f.commit();
  assert.notEqual(result.status, 0, f.output(result));
});

test("作業ツリーを戻していてもステージ済みCLIのビルド不能を拒否する", () => {
  const f = fixture();
  const file = join(f.root, "src/cli.ts");
  const original = readFileSync(file, "utf8");
  writeFileSync(
    file,
    original + '\nconst invalidStatus: number = "invalid";\nprocess.exitCode = invalidStatus;\n',
  );
  f.git("add", "src/cli.ts");
  writeFileSync(file, original);
  const result = f.commit();
  assert.notEqual(result.status, 0, f.output(result));
  assert.match(f.output(result), /build/);
});

test("設定で変更した管理ディレクトリも検査する", () => {
  const f = fixture();
  mkdirSync(join(f.root, ".links"));
  cpSync(join(f.root, ".crosslink/pair.json"), join(f.root, ".links/pair.json"));
  rmSync(join(f.root, ".crosslink"), { recursive: true });
  writeFileSync(
    join(f.root, "crosslink.config.json"),
    JSON.stringify({ directoryName: ".links" }, null, 2) + "\n",
  );
  const formatConfig = JSON.parse(readFileSync(join(f.root, ".oxfmtrc.json"), "utf8"));
  formatConfig.ignorePatterns.push(".links/**");
  writeFileSync(join(f.root, ".oxfmtrc.json"), JSON.stringify(formatConfig, null, 2) + "\n");
  writeFileSync(join(f.root, "a"), "changed");
  f.git("add", ".");
  const result = f.commit();
  assert.notEqual(result.status, 0, f.output(result));
  assert.match(f.output(result), /Unconfirmed/);
});

test("未ステージの属性変更を取り込まず、ステージ済みの改行設定で検査する", () => {
  const f = fixture();
  writeFileSync(join(f.root, "a"), "line\n");
  writeFileSync(join(f.root, ".gitattributes"), "a text eol=lf\n");
  f.confirm();
  f.git("add", ".");
  writeFileSync(join(f.root, ".gitattributes"), "a text eol=crlf\n");
  const result = f.commit();
  assert.equal(result.status, 0, f.output(result));
  assert.equal(readFileSync(join(f.root, ".gitattributes"), "utf8"), "a text eol=crlf\n");
  assert.equal(f.git("show", "HEAD:a"), "line\n");
});

test("git commit --onlyの一時indexを検査し、別のステージ済み変更を保持する", () => {
  const f = fixture();
  const first = f.commit();
  assert.equal(first.status, 0, f.output(first));
  writeFileSync(join(f.root, "a"), "other staged change");
  f.git("add", "a");
  const index = f.git("ls-files", "--stage");
  const result = f.commit("--allow-empty", "--only", "b");
  assert.equal(result.status, 0, f.output(result));
  assert.equal(f.git("show", "HEAD:a"), "a");
  assert.equal(f.git("ls-files", "--stage"), index);
});

test("ステージ済みformat違反を拒否し、作業ツリーとindexを保持する", () => {
  const f = fixture();
  const file = join(f.root, "package.json");
  const original = readFileSync(file, "utf8");
  writeFileSync(file, JSON.stringify(JSON.parse(original)));
  f.git("add", "package.json");
  writeFileSync(file, original);
  const index = f.git("ls-files", "--stage");
  const result = f.commit();
  assert.notEqual(result.status, 0, f.output(result));
  assert.match(f.output(result), /oxfmt|整形/);
  assert.equal(readFileSync(file, "utf8"), original);
  assert.equal(f.git("ls-files", "--stage"), index);
});

test("ステージ済みlint違反を拒否し、作業ツリーとindexを保持する", () => {
  const f = fixture();
  const file = join(f.root, "src/cli.ts");
  const original = readFileSync(file, "utf8");
  writeFileSync(file, original + "\ndebugger;\n");
  f.git("add", "src/cli.ts");
  writeFileSync(file, original);
  const index = f.git("ls-files", "--stage");
  const result = f.commit();
  assert.notEqual(result.status, 0, f.output(result));
  assert.match(f.output(result), /oxlint|lint/);
  assert.equal(readFileSync(file, "utf8"), original);
  assert.equal(f.git("ls-files", "--stage"), index);
});

test("未ステージのlintとformat違反はコミット判定へ混ぜない", () => {
  const f = fixture();
  const manifest = join(f.root, "package.json");
  writeFileSync(manifest, JSON.stringify(JSON.parse(readFileSync(manifest, "utf8"))));
  writeFileSync(
    join(f.root, "src/cli.ts"),
    readFileSync(join(f.root, "src/cli.ts"), "utf8") + "\ndebugger;\n",
  );
  const index = f.git("ls-files", "--stage");
  const result = f.commit();
  assert.equal(result.status, 0, f.output(result));
  assert.equal(f.git("ls-files", "--stage"), index);
});

test("crosslinkグループ0件でも開発プロジェクトのformatを検査する", () => {
  const f = fixture({ groups: false });
  const manifest = join(f.root, "package.json");
  writeFileSync(manifest, JSON.stringify(JSON.parse(readFileSync(manifest, "utf8"))));
  f.git("add", "package.json");
  const result = f.commit();
  assert.notEqual(result.status, 0, f.output(result));
  assert.match(f.output(result), /oxfmt|整形/);
});

test("glob一致集合はステージ済み内容だけで検査し、追加・削除を古い確認で通さない", () => {
  const f = fixture({ groups: false });
  mkdirSync(join(f.root, "adr"));
  writeFileSync(join(f.root, "adr/one.md"), "same\n");
  writeFileSync(join(f.root, "adr/two.md"), "same\n");
  assert.equal(f.cli("create", "adr", "a", "--glob", "adr/**/*.md", "--reason", "review").status, 0);
  f.confirm();
  f.git("add", ".");
  { const committed = f.commit(); assert.equal(committed.status, 0, f.output(committed)); }
  // 未追跡の追加はindexには入らないため、indexの旧集合は確認済み。
  writeFileSync(join(f.root, "adr/added.md"), "same\n");
  assert.equal(f.cli("check").status, 1);
  assert.equal(f.commit("--allow-empty").status, 0);
  f.git("add", "adr/added.md");
  const index = f.git("ls-files", "--stage");
  const record = readFileSync(join(f.root, ".crosslink/adr.json"), "utf8");
  const failed = f.commit();
  assert.notEqual(failed.status, 0, f.output(failed));
  assert.equal(f.git("ls-files", "--stage"), index);
  assert.equal(readFileSync(join(f.root, ".crosslink/adr.json"), "utf8"), record);
  f.confirm();
  f.git("add", ".crosslink/adr.json");
  { const committed = f.commit(); assert.equal(committed.status, 0, f.output(committed)); }
  f.git("rm", "adr/added.md");
  const deleted = f.commit();
  assert.notEqual(deleted.status, 0, f.output(deleted));
  assert.match(f.output(deleted), /Unconfirmed/);
  f.confirm();
  f.git("add", ".crosslink/adr.json");
  { const committed = f.commit(); assert.equal(committed.status, 0, f.output(committed)); }
  // 未ステージのrename/deletionもindexへ混ぜない。stageすると旧記録では拒否する。
  renameSync(join(f.root, "adr/one.md"), join(f.root, "adr/renamed.md"));
  { const unchanged = f.commit("--allow-empty"); assert.equal(unchanged.status, 0, f.output(unchanged)); }
  f.git("add", "--all", "adr");
  { const renamed = f.commit(); assert.notEqual(renamed.status, 0, f.output(renamed)); assert.match(f.output(renamed), /Unconfirmed/); }
  f.confirm();
  f.git("add", ".crosslink/adr.json");
  writeFileSync(join(f.root, "b"), "unrelated staged change");
  f.git("add", "b");
  const selected = f.commit("--only", "adr/one.md", "adr/renamed.md", ".crosslink/adr.json");
  assert.equal(selected.status, 0, f.output(selected));
  assert.equal(f.git("show", "HEAD:b"), "b");
  assert.equal(f.git("show", ":b"), "unrelated staged change");
  rmSync(join(f.root, "adr/two.md"));
  { const unchanged = f.commit("--allow-empty"); assert.equal(unchanged.status, 0, f.output(unchanged)); }
});

test("globへ検査用distを混入させず、stageされたdistは保持する", () => {
  const f = fixture({ groups: false });
  writeFileSync(join(f.root, "manual.js"), "export {};\n");
  mkdirSync(join(f.root, "dist"));
  writeFileSync(join(f.root, "dist/intentional.js"), "export {};\n");
  assert.equal(f.cli("create", "javascript", "a", "--glob", "**/*.js", "--reason", "review").status, 0);
  f.confirm();
  f.git("add", ".");
  f.git("add", "--force", "dist/intentional.js");
  const result = f.commit();
  assert.equal(result.status, 0, f.output(result));
  assert.equal(f.git("show", "HEAD:dist/intentional.js"), "export {};\n");
});

test("stageされたnode_modules実ファイルを注入リンク扱いで削除しない", () => {
  const f = fixture({ groups: false });
  rmSync(join(f.root, "node_modules"));
  mkdirSync(join(f.root, "node_modules/manual"), { recursive: true });
  writeFileSync(join(f.root, "node_modules/manual/kept.txt"), "kept");
  assert.equal(f.cli("create", "manual", "a", "--glob", "node_modules/manual/*.txt", "--reason", "review").status, 0);
  f.confirm();
  f.git("add", ".");
  f.git("add", "--force", "node_modules/manual/kept.txt");
  rmSync(join(f.root, "node_modules"), { recursive: true });
  symlinkSync(join(sourceRoot, "node_modules"), join(f.root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const result = f.commit();
  assert.equal(result.status, 0, f.output(result));
  assert.equal(f.git("show", "HEAD:node_modules/manual/kept.txt"), "kept");
});

test("glob利用グループの絶対・外部参照をhookだけで拒否しindexと作業ツリーを保持する", () => {
  for (const mode of ["absolute-glob", "external-glob", "absolute-fixed", "external-fixed", "external-symlink"]) {
    const f = fixture({ groups: false });
    const outside = join(dirname(f.root), "outside.txt");
    writeFileSync(outside, "outside");
    const file = join(f.root, ".crosslink/dynamic.json");
    const args = ["create", "dynamic", "a", "b", "--glob", "a", "--reason", "review"];
    if (mode === "absolute-glob") args.push("--glob", realpathSync(join(f.root, "b")));
    if (mode === "external-glob") args.push("--glob", "../outside.txt");
    if (mode === "absolute-fixed") args.push(join(f.root, "src/cli.ts"));
    if (mode === "external-fixed") args.push("../outside.txt");
    if (mode === "external-symlink") { symlinkSync(outside, join(f.root, "external.txt")); args.push("--glob", "external.txt"); }
    assert.equal(f.cli(...args).status, 0);
    f.confirm();
    f.git("add", ".");
    const index = f.git("ls-files", "--stage"), record = readFileSync(file, "utf8");
    const result = f.commit();
    assert.notEqual(result.status, 0, mode + ": " + f.output(result));
    assert.match(f.output(result), /STAGED_REFERENCE_UNSUPPORTED/);
    assert.equal(f.git("ls-files", "--stage"), index);
    assert.equal(readFileSync(file, "utf8"), record);
    assert.equal(readFileSync(outside, "utf8"), "outside");
  }
});

test("既存の静的グループは外部固定参照の契約を維持する", () => {
  const f = fixture({ groups: false });
  const outside = join(dirname(f.root), "outside.txt");
  writeFileSync(outside, "outside");
  assert.equal(f.cli("create", "static", "a", outside, "--reason", "legacy external").status, 0);
  f.confirm();
  f.git("add", ".");
  const result = f.commit();
  assert.equal(result.status, 0, f.output(result));
});

test("core.symlinks=falseでもindexの外部file linkを専用診断で拒否し全入力を保持する", () => {
  const f = fixture({ groups: false }), outside = join(dirname(f.root), "outside.txt");
  writeFileSync(outside, "external bytes");
  symlinkSync(outside, join(f.root, "external.txt"));
  assert.equal(f.cli("create", "dynamic", "a", "--glob", "external.txt", "--reason", "review").status, 0);
  f.confirm();
  f.git("add", ".");
  f.git("config", "core.symlinks", "false");
  const mode = f.git("ls-files", "--stage", "--", "external.txt");
  assert.match(mode, /^120000 /);
  // 外部の本文をindexのlink文字列と同じにしても、専用境界で拒否しなければならない。
  const targetBytes = f.git("cat-file", "blob", mode.split(" ")[1]);
  writeFileSync(outside, targetBytes);
  f.confirm();
  f.git("add", ".crosslink/dynamic.json");
  // commit自身が作るcache-treeを先に用意し、hookによるindex変更だけを照合する。
  f.git("write-tree");
  const linkTarget = readlinkSync(join(f.root, "external.txt"));
  const index = readFileSync(join(f.root, ".git/index")), record = readFileSync(join(f.root, ".crosslink/dynamic.json")), config = readFileSync(join(f.root, ".git/config"));
  const result = f.commit();
  assert.notEqual(result.status, 0, f.output(result));
  assert.match(f.output(result), /STAGED_REFERENCE_UNSUPPORTED/, mode + f.output(result));
  assert.match(f.output(result), /120000/);
  assert.deepEqual(readFileSync(join(f.root, ".git/index")), index);
  assert.deepEqual(readFileSync(join(f.root, ".git/config")), config);
  assert.deepEqual(readFileSync(join(f.root, ".crosslink/dynamic.json")), record);
  assert.equal(lstatSync(join(f.root, "external.txt")).isSymbolicLink(), true);
  assert.equal(readlinkSync(join(f.root, "external.txt")), linkTarget);
  assert.equal(readFileSync(outside, "utf8"), targetBytes);
});

test("core.symlinks=falseでもindexの内部file linkを通常ファイル本文と混同せず検査する", () => {
  const f = fixture({ groups: false });
  writeFileSync(join(f.root, "b"), "target content differs from link text");
  symlinkSync("b", join(f.root, "inside.txt"));
  assert.equal(f.cli("create", "dynamic", "a", "--glob", "inside.txt", "--reason", "review").status, 0);
  f.confirm();
  f.git("add", ".");
  f.git("config", "core.symlinks", "false");
  rmSync(join(f.root, "inside.txt"));
  writeFileSync(join(f.root, "inside.txt"), "b");
  const index = f.git("ls-files", "--stage"), record = readFileSync(join(f.root, ".crosslink/dynamic.json"));
  assert.match(f.git("ls-files", "--stage", "--", "inside.txt"), /^120000 /);
  const result = f.commit();
  assert.equal(result.status, 0, f.output(result));
  assert.equal(f.git("ls-files", "--stage"), index);
  assert.deepEqual(readFileSync(join(f.root, ".crosslink/dynamic.json")), record);
  assert.equal(lstatSync(join(f.root, "inside.txt")).isSymbolicLink(), false);
  assert.equal(readFileSync(join(f.root, "inside.txt"), "utf8"), "b");
  assert.equal(f.git("config", "--get", "core.symlinks").trim(), "false");
});

test("core.symlinks=falseでもindexのdirectory linkへ降りず0一致を正しく診断する", () => {
  const f = fixture({ groups: false });
  mkdirSync(join(f.root, "docs"));
  writeFileSync(join(f.root, "docs/one.md"), "one\n");
  writeFileSync(join(f.root, "linked"), "docs");
  assert.equal(f.cli("create", "dynamic", "a", "b", "--glob", "linked/*.md", "--reason", "review").status, 0);
  f.git("add", ".");
  const oid = f.git("hash-object", "--", "linked").trim();
  f.git("update-index", "--cacheinfo", "120000", oid, "linked");
  f.git("config", "core.symlinks", "false");
  const index = f.git("ls-files", "--stage");
  const result = f.commit();
  assert.notEqual(result.status, 0, f.output(result));
  assert.match(f.output(result), /GLOB_NO_MATCH/, f.output(result));
  assert.doesNotMatch(f.output(result), /ENOTDIR/);
  assert.equal(f.git("ls-files", "--stage"), index);
  assert.equal(readFileSync(join(f.root, "linked"), "utf8"), "docs");
  assert.equal(readFileSync(join(f.root, "docs/one.md"), "utf8"), "one\n");
  assert.equal(f.git("config", "--get", "core.symlinks").trim(), "false");
});

test("core.symlinks=falseでもstatic-onlyの外部file link互換を維持する", () => {
  const f = fixture({ groups: false }), outside = join(dirname(f.root), "outside.txt");
  writeFileSync(outside, "external static bytes");
  symlinkSync(outside, join(f.root, "external.txt"));
  assert.equal(f.cli("create", "static", "a", "external.txt", "--reason", "legacy").status, 0);
  f.confirm();
  f.git("add", ".");
  f.git("config", "core.symlinks", "false");
  const index = f.git("ls-files", "--stage");
  const result = f.commit();
  assert.equal(result.status, 0, f.output(result));
  assert.equal(f.git("ls-files", "--stage"), index);
  assert.equal(readFileSync(outside, "utf8"), "external static bytes");
  assert.equal(f.git("config", "--get", "core.symlinks").trim(), "false");
});

test("core.symlinks=falseで再現不能なindex mode120000を同hashの通常ファイルとして通さない", () => {
  const f = fixture({ groups: false });
  // NULで始まるlink targetは実symlinkとして作れないが、通常ファイル本文ならhashが一致する。
  writeFileSync(join(f.root, "broken.bin"), Buffer.from([0, 97]));
  assert.equal(f.cli("create", "dynamic", "a", "--glob", "broken.bin", "--reason", "review").status, 0);
  f.confirm();
  f.git("add", ".");
  const oid = f.git("hash-object", "--", "broken.bin").trim();
  f.git("update-index", "--cacheinfo", "120000", oid, "broken.bin");
  f.git("config", "core.symlinks", "false");
  const index = f.git("ls-files", "--stage"), record = readFileSync(join(f.root, ".crosslink/dynamic.json"));
  const result = f.commit();
  assert.notEqual(result.status, 0, f.output(result));
  assert.match(f.output(result), /STAGED_REFERENCE_UNSUPPORTED/);
  assert.match(f.output(result), /120000/);
  assert.equal(f.git("ls-files", "--stage"), index);
  assert.deepEqual(readFileSync(join(f.root, ".crosslink/dynamic.json")), record);
  assert.deepEqual(readFileSync(join(f.root, "broken.bin")), Buffer.from([0, 97]));
  assert.equal(f.git("config", "--get", "core.symlinks").trim(), "false");
});
