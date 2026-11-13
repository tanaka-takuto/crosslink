#!/bin/sh

set -eu

repo_root=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
cd "$repo_root"

for hook in commit-msg pre-commit pre-push; do
  test -f ".githooks/$hook"
done
test -f .githooks/commit-message-template

# この clone の設定だけを更新する。グローバル設定には触れない。
chmod +x .githooks/commit-msg .githooks/pre-commit .githooks/pre-push
git config --local core.hooksPath .githooks
git config --local commit.template .githooks/commit-message-template
printf '%s\n' 'Git hooks を設定しました: .githooks'
