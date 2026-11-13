#!/bin/sh

set -eu

base=${1:?usage: check-commit-messages.sh BASE HEAD}
head=$(git rev-parse --verify --end-of-options "${2:?usage: check-commit-messages.sh BASE HEAD}^{commit}")

# PR の分岐点以降を検査する。初回 push のゼロ SHA は全履歴を対象にする。
case "$base" in
  *[!0]*)
    base=$(git rev-parse --verify --end-of-options "$base^{commit}")
    shared_base=$(git merge-base "$base" "$head")
    range="$shared_base..$head"
    ;;
  *) range=$head ;;
esac

commits=$(git rev-list "$range")
status=0
for commit in $commits; do
  # 履歴中の # で始まる行も本文として検査する。内容はログへ出さない。
  message=$(git show --no-patch --no-notes --format=%B "$commit")
  case "$message" in
    ''|*'
'*)
      printf 'commit-message: %s は1行ではありません。本文・フッターを削除してください。\n' "$commit" >&2
      status=1
      ;;
  esac
done

if [ "$status" -eq 0 ]; then
  printf '%s\n' 'Commit message checks passed'
fi
exit "$status"
