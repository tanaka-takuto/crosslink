import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
