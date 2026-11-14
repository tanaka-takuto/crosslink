# Git / GitHub の開発運用

## 初回設定と検査

開発には Node.js 24 以降と pnpm 12.18.0 を使用します。推奨 Node.js は `.node-version` を参照してください。
`pnpm install --frozen-lockfile` の後、`pnpm check` で製品の型・整形・lint・テスト・ビルド・自己検査を実行します。
テストは対応する実装の隣へ置きます。ビルド後のCLIには実行時の外部パッケージはなく、Node.jsだけで動作します。
既存のGitフックの設定・検査にはGitとPOSIX shellも使用します。
clone ごとにフックを設定してください。

```sh
sh script/setup-githooks.sh
sh script/check-git.sh
```

設定はこの clone の `core.hooksPath` と `commit.template` だけに適用します。
ローカルフックは未設定や `--no-verify` で回避できますが、同じ規則を必須 CI でも検査します。

## Issue

変更を始める前に、このリポジトリの実在する Issue を用意します。作成前に Open Issue を検索します。
`.github/ISSUE_TEMPLATE/` のうち、目的に合うフォームを使用してください。

| フォーム         | 記録すること                                         |
| ---------------- | ---------------------------------------------------- |
| 不具合報告       | 観測した問題、再現と証拠、期待結果と完了条件、環境   |
| 機能・改善提案   | 利用場面の問題、提案する振る舞い、観測可能な完了条件 |
| 開発・運用タスク | 現状の問題、変更後の状態、維持する条件、検証方法     |
| 調査・検討       | 決めたい問い、既知の事実、調査方法、結論を出せる条件 |

原因の仮説を事実として記載しません。不明・未確認の情報はそのまま明記します。
ログや設定例からは認証情報・個人情報を除いてください。
CLI / API で Issue を作る場合も、フォームの必須項目を見出しとして記入します。

## コミット

コミットメッセージは `type(#Issue番号): 説明` の1行にします。
Issue 番号は正の整数とし、本文・フッターは使用しません。詳細は PR に記載します。
日本語を許可し、文字数制限は設けません。

```text
chore(#123): Git の開発設定を追加する
fix(#123): 引数の検証を修正する
feat(#123)!: 出力形式を変更する
```

type は `build`、`chore`、`ci`、`docs`、`feat`、`fix`、`perf`、`refactor`、
`revert`、`style`、`test` を使用できます。破壊的変更は `!` で示します。
`fixup!`、`squash!`、`amend!` を使う場合も、その後の件名に Issue 番号を要求します。
merge・revert にも例外はありません。例えば main を取り込む merge は、
`chore(#123): main を統合する` のようにメッセージを指定してください。
エディターのコメント・前後の空行・末尾空白を除去し、検査済みの1行を保存します。

導入前の履歴は書き換えません。CI は PR の分岐点以降、main への push では新たに追加されたコミットだけを検査します。

## ブランチと PR

作業内容に対応したブランチを作り、PR で main に取り込みます。

```sh
git switch -c 'issue/#123'
git switch -c 'issue/#123-review-layer'
git switch -c feat/add-command
```

`issue/#<正の整数>`、任意の layer 名、`setup/` またはコミット type と同じ prefix を許可します。
後ろには小文字英数字・`.`・`_`・`-`・`/` を使用します。`dependabot/...` も許可します。
ブランチ名に番号がなくても、コミット・PR タイトル・Development の Issue 紐づけは必須です。

PR は `.github/pull_request_template.md` を使用し、5つの節を記入します。

- 目的・期待する結果: 解決する問題と、変更後に実現する状態。
- 変更内容と理由: 意味のある変更と、diff から分からない判断。
- 検証結果: 実行した確認、実際の結果、環境と証拠。未実施なら理由を記載する。
- レビューしてほしい点: 判断してほしい点。特記がなければその旨を記載する。
- 影響・未確認事項: 互換性、移行、運用上の影響、未確認条件。

コメント、空欄、`TODO` などのプレースホルダーだけでは検査に通りません。
予定や期待を検証済みとして記載しません。CI の構造検査は、説明の正しさを保証するものではありません。

PR の Development 欄に、このリポジトリの Issue を少なくとも1つ紐づけます。
PR タイトルも `type(#123): 説明` の1行にし、タイトルと各新規コミットの番号を実リンクに対応させます。
本文の `Refs #123` だけでは代用できません。`Closes #123` は任意であり、文字列自体は検査しません。
手動操作やキーワードによって GitHub 上のリンクが成立しているかを API で確認します。

Development のリンクを追加・削除・付け替えた場合は、PR の最新の Actions 実行から
「Re-run all jobs」を実行してください。リンクの変更だけでは自動再実行されない場合があります。
取得に失敗した場合や、取得中に HEAD が変わった場合は、未確認のまま成功扱いにしません。
Dependabot を含む bot の PR にも例外はありません。必要な Issue とコミットを整えてから取り込みます。

## フックと CI

- `pre-commit`: ステージ済みの空白エラー、oxfmtの整形、oxlint、crosslinkの確認状態を検査します。
- `commit-msg`: Issue 番号付きの1行形式を検査し、コメント等を除去した1行を保存します。
- `pre-push`: push 先のブランチ名を検査します。全テストは実行しません。
- `sh script/check-git.sh`: shell 構文、空白エラー、Git フックと PR 判定のテストを実行します。
- `sh script/check-commit-messages.sh BASE HEAD`: 指定範囲の全コミットを検査します。

コミット対象のindexを一時ディレクトリへ取り出し、まずCIと同じ設定で `oxfmt --check .` と `oxlint --deny-warnings src vitest.config.ts` を実行します。
整形やlintの違反があれば、元のファイルを修正して再ステージしてください。
crosslinkの検査は、同じステージ済み内容のCLIをビルドして実行します。
作業ツリーの未ステージ変更や古いdistは使いません。`git commit --only` でGitが用意する一時indexも対象にします。
検査の成否にかかわらず、元の作業ツリーとindexの内容を保持し、検査用ディレクトリを削除します。
Node.js 24以上とインストール済みの開発依存が必要です。依存不足・ビルド不能・検査不能はコミットを止め、修復方法を表示します。自動installはしません。
管理グループと設定が存在しない場合も、開発プロジェクトでは整形・lintを検査し、crosslinkは登録0件を通知します。

未確認で拒否された場合は対象の内容を確認し、変更ファイルと対応する確認記録を両方ステージしてください。
部分ステージでは、コミットする内容の組み合わせと確認記録が一致するように整えます。
実際のGitリポジトリとフックによるテストは `node --test script/check-staged.test.mjs` で実行でき、`pnpm test` にも含まれます。

GitHub Actions は Node.js 24 を使い、同じ検査入口を Linux と macOS で実行します。
`Git policy` は全 OS の結果を集約します。`PR policy` は Development の実リンク、PR タイトル、
各コミットの Issue 番号、PR 本文を検査します。本文・タイトルの編集でも再検査します。
CLI 本体は `CLI policy` により Linux・macOS・Windows、Node.js 24・26で `pnpm check` を実行します。
この6環境で、ステージ済み内容を検査するpre-commitの実行テストも行います。

Actions の既定権限は読み取り専用とし、PR を承認する権限は与えません。
外部 Action は完全な commit SHA で固定します。
Dependabot は毎週月曜 09:00 JST に Actions の更新を確認し、minor・patch はまとめ、major は個別に扱います。

## main の保護

`.github/rulesets/default-branch.json` の ruleset を GitHub に設定し、現在のデフォルトブランチに適用します。
バイパス対象は設定しません。JSON ファイルを変更しただけでは GitHub 設定は変わらないため、
設定を更新した場合は GitHub API から読み戻して実際の適用状態を確認します。

- PR と最新の main に対する `Git policy`・`PR policy`・`CLI policy` の成功を必須にします。
- 未解決のレビュー会話がある場合はマージできません。
- 管理者にもルールを適用し、force push とブランチ削除を禁止します。
- 必須のレビュー承認数は 0 とします。これは人間による承認を保証しません。
- 通常の merge commit と auto-merge を基本にし、squash merge・rebase merge は無効にします。
- レビュー可能な状態の PR で auto-merge を有効にし、必須チェックの成功を待ちます。管理者権限で検査を迂回しません。
- GitHub の merge commit は PR タイトルを件名にし、本文を空にします。マージ時に本文を追加しないでください。
- マージ済みの作業ブランチは自動削除します。

このリポジトリでは GitHub の commit metadata rules を利用できないため、PR 内のコミットは必須 CI、
マージメッセージは本文なしの既定設定とマージ時の確認で管理します。

merge queue は Organization 所有リポジトリ向けの機能であり、現在の個人所有リポジトリでは利用できません。
参照: [GitHub の merge queue 利用条件](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)。
