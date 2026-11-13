#!/bin/sh

set -eu

repo_root=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/crosslink-githooks.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT
trap 'exit 1' HUP INT TERM

# 実際の設定・認証・作業ファイルを使わず、一時リポジトリだけを操作する。
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR
unset GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME='Hook Test' GIT_AUTHOR_EMAIL='hooks@example.invalid'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

test_repo="$test_dir/repo"
git init --quiet --initial-branch=main "$test_repo"
git -C "$test_repo" config core.hooksPath "$repo_root/.githooks"
git -C "$test_repo" config commit.gpgsign false
git -C "$test_repo" config tag.gpgsign false
cd "$test_repo"

count=0
expect() {
  expected=$1
  label=$2
  shift 2
  actual=success
  if ! "$@" > "$test_dir/output" 2>&1; then
    actual=failure
  fi
  if [ "$actual" != "$expected" ]; then
    printf 'FAIL: %s (expected %s, got %s)\n' "$label" "$expected" "$actual" >&2
    cat "$test_dir/output" >&2
    exit 1
  fi
  count=$((count + 1))
}

# Git 自身からフックを呼び、メッセージの受理・拒否を確認する。
expect failure '形式のないコミットを拒否' git commit --allow-empty -m 'invalid message'
expect success 'Issue なし・日本語のコミットを許可' git commit --allow-empty -m 'chore: 開発設定を追加する'
expect success 'scope と本文・フッターを許可' git commit --allow-empty -m 'fix(git): 検査を修正する' -m '理由を本文に記録する。' -m 'Refs: #123'
expect success '破壊的変更の記法を許可' git commit --allow-empty -m 'feat(cli)!: change output format' -m 'BREAKING CHANGE: output format changed'
expect success '日本語をバイト数で制限しない' git commit --allow-empty -m 'docs: 日本語でもバイト数の違いでコミットできなくならないことを確認するための説明を追加する'
expect failure '説明が空なら拒否' git commit --allow-empty -m 'fix: '
expect failure '未定義の type を拒否' git commit --allow-empty -m 'unknown: message'
expect success 'Git の merge メッセージを許可' git commit --allow-empty -m "Merge branch 'setup/git-github'"
expect success 'fixup を許可' git commit --allow-empty -m 'fixup! chore: 開発設定を追加する'

# 部分ステージでは index を検査し、作業ツリーと index を書き換えない。
printf 'staged content\n' > 'partial file.txt'
git add -- 'partial file.txt'
printf 'unstaged content  \n' > 'partial file.txt'
cp 'partial file.txt' "$test_dir/working-before"
expect success '未ステージの空白エラーは対象外' git commit -m 'test: 部分ステージを保持する'
expect success '作業ツリーを変更しない' cmp 'partial file.txt' "$test_dir/working-before"
printf 'staged content\n' > "$test_dir/staged-expected"
git show 'HEAD:partial file.txt' > "$test_dir/staged-actual"
expect success 'ステージ済みの内容だけをコミット' cmp "$test_dir/staged-expected" "$test_dir/staged-actual"

printf 'bad staged content  \n' > 'bad file.txt'
git add -- 'bad file.txt'
printf 'different working content\n' > 'bad file.txt'
cp 'bad file.txt' "$test_dir/bad-working-before"
git show ':bad file.txt' > "$test_dir/bad-index-before"
expect failure 'ステージ済みの空白エラーを拒否' git commit -m 'test: 空白エラーを検出する'
expect success '拒否時も作業ツリーを保持' cmp 'bad file.txt' "$test_dir/bad-working-before"
git show ':bad file.txt' > "$test_dir/bad-index-after"
expect success '拒否時も index を保持' cmp "$test_dir/bad-index-before" "$test_dir/bad-index-after"
git reset --quiet HEAD -- 'bad file.txt'

# 外部通信をせず、ローカル bare repository への push で検査する。
git init --quiet --bare --initial-branch=main "$test_dir/remote.git"
git remote add origin "$test_dir/remote.git"
expect success 'main を許可' git push origin HEAD:refs/heads/main
expect success 'Issue なしの setup ブランチを許可' git push origin HEAD:refs/heads/setup/git-github
expect success 'Issue ブランチを許可' git push origin 'HEAD:refs/heads/issue/#123'
expect success 'Issue の分割ブランチを許可' git push origin 'HEAD:refs/heads/issue/#123-review-layer'
expect success 'Dependabot のブランチを許可' git push origin HEAD:refs/heads/dependabot/github_actions/actions/checkout-6
expect failure '規則外のリモートブランチ名を拒否' git push origin HEAD:refs/heads/random-branch
expect failure 'Issue 番号 0 を拒否' git push origin 'HEAD:refs/heads/issue/#0'
git tag v0.0.0-test
expect success 'タグの push はブランチ名検査の対象外' git push origin refs/tags/v0.0.0-test
git --git-dir="$test_dir/remote.git" update-ref refs/heads/old-branch HEAD
expect success '既存の規則外ブランチの削除を許可' git push origin :refs/heads/old-branch

printf 'Git hooks: %s checks passed\n' "$count"
