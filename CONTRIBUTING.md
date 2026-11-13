# Git / GitHub の開発運用

## 初回設定と検査

Git と POSIX shell を使用します。clone ごとにフックを設定してください。

```sh
sh script/setup-githooks.sh
sh script/check-git.sh
```

設定はこの clone の `core.hooksPath` と `commit.template` だけに適用します。
ローカルフックは補助であり、未設定や `--no-verify` で回避できます。
GitHub 側では main の PR と必須チェック `Git policy` を要求します。

## コミット

Conventional Commits の `type(scope): 説明` を使用します。scope は省略可能です。
コミットメッセージは必ず1行とし、本文・フッターは使用しません。詳細は PR に記載します。
日本語を許可し、文字数制限や Issue 番号の必須化は行いません。

```text
chore: Git の開発設定を追加する
fix(cli): 引数の検証を修正する
feat(cli)!: 出力形式を変更する
```

type は `build`、`chore`、`ci`、`docs`、`feat`、`fix`、`perf`、`refactor`、
`revert`、`style`、`test` を使用できます。
破壊的変更は `!` で示します。
Git が作る merge、revert、fixup、squash、amend のメッセージも1行の場合だけ許可します。
エディターのコメント・前後の空行・末尾空白を除去し、検査済みの1行を保存します。

## ブランチと変更の進め方

Issue は必須ではありません。作業内容に対応したブランチを作り、PR で main に取り込みます。

```sh
git switch -c setup/git-github
git switch -c feat/add-command
git switch -c 'issue/#123'
git switch -c 'issue/#123-review-layer'
```

Issue なしのブランチには `setup/` またはコミット type と同じ prefix を使い、
後ろに小文字英数字・`.`・`_`・`-`・`/` で作業名を付けます。
Issue ブランチは `issue/#<正の整数>` とし、任意で `-review-layer` のような名前を付けます。
Dependabot の `dependabot/...` ブランチも許可します。
タグと既存ブランチの削除は名前の検査対象外です。

## フックと CI

- `pre-commit`: ステージ済みの空白エラーを検査します。自動整形や再ステージは行いません。
- `commit-msg`: 1行制限と形式を検査し、コメント等を除去した1行を保存します。本文がある場合は拒否します。
- `pre-push`: push 先のブランチ名を検査します。全テストは実行しません。
- `sh script/check-git.sh`: shell 構文、空白エラー、実際の Git 操作を使うフックテストを実行します。

GitHub Actions も同じ検査入口を Linux と macOS で実行します。
PR では分岐点以降、main への push では追加された全コミットのメッセージを検査します。
フックを通さず作られたコミットや Dependabot のコミットも、本文・フッターがあれば拒否します。
更新 PR に複数行のコミットがある場合は、1行のコミットへ作り直してから取り込みます。
ローカルでは `sh script/check-commit-messages.sh BASE HEAD` で同じ検査を実行できます。
全 OS の成功を集約する `Git policy` を main の必須チェックとします。
これは Git の開発運用の検査です。CLI 本体の品質検査は、本体の実装に合わせて追加します。

Actions の既定権限は読み取り専用とし、PR を承認する権限は与えません。
外部 Action は完全な commit SHA で固定します。
Dependabot は毎週月曜 09:00 JST に Actions の更新を確認し、minor・patch はまとめ、
major は個別に扱います。自動マージは使用しません。

## main の保護

- PR と最新の main に対する `Git policy` の成功を必須にします。
- 未解決のレビュー会話がある場合はマージできません。
- 管理者にもルールを適用し、force push とブランチ削除を禁止します。
- 個人でも運用できるよう、必須のレビュー承認数は 0 とします。これは人間による承認を保証しません。
- 通常の merge commit を使い、squash merge・rebase merge・auto-merge は無効にします。
- GitHub の merge commit は PR タイトルを件名にし、既定の本文を空にします。
  PR タイトルも1行の Conventional Commits 形式にし、マージ時に本文を追加しないでください。
- このリポジトリでは GitHub の commit metadata rules を利用できないため、
  PR 内のコミットは必須 CI、マージメッセージは本文なしの既定設定とマージ時の確認で管理します。
- マージ済みの作業ブランチは自動削除します。

初回の設定導入だけは、検査 workflow を main へ push して成功を確認した後に保護を有効にします。
Issue・PR テンプレートは今回の導入範囲に含めません。
