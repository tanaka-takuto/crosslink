# Repository instructions

ユーザーとの対話と説明は日本語で行う。

- 作業前に `CONTRIBUTING.md` と対応する Issue を読む。
- Issue 作成には `.github/ISSUE_TEMPLATE/`、PR 作成には `.github/pull_request_template.md` を使う。
- コミットと PR タイトルは `type(#Issue番号): 説明` の1行とし、Development に同じ Issue を紐づける。
- `Closes #123` の記載は任意。本文の番号だけで実リンクを確認したことにしない。
- PR の検証結果には実行した確認と実際の結果を書き、未実施・失敗・未確認を成功と混ぜない。
- コミット前に `sh script/check-git.sh` を実行する。新しい判定規則は失敗テストから実装する。
- レビュー可能な PR は auto-merge を基本にし、必須チェックの成功を待つ。管理者権限で検査を迂回しない。
- マージコミットも Issue 番号付きの1行にし、PR タイトルを件名、本文を空にする。
