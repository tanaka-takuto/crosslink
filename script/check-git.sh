#!/bin/sh

set -eu

repo_root=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
cd "$repo_root"

for file in .githooks/commit-msg .githooks/pre-commit .githooks/pre-push script/*.sh; do
  sh -n "$file"
done

# CI ではコミット済みの全ファイルを、ローカルでは追加の差分も検査する。
empty_tree=$(git hash-object -t tree /dev/null)
git diff --check "$empty_tree" HEAD
git diff --check
git diff --cached --check
sh script/test-githooks.sh
node --test script/pr-policy.test.mjs
printf '%s\n' 'Git checks passed'
