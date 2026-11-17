# 開発ツールと実行環境

実装はTypeScript、テストはVitest、パッケージ管理はpnpm、整形はoxfmt、lintはoxlintを使う。
テストは対応する実装の隣へ `domain/group.ts`・`domain/group.test.ts` のように置く。
TypeScriptで型検査し、JavaScriptのES Modulesへビルドする。テストは実行用ビルドから除外する。

ビルド後のCLIに実行時の外部パッケージはない。Node.js 24以上の標準機能だけを使用する。
開発用の推奨Node.jsは `.node-version`、pnpmは `package.json` の `packageManager` で固定する。
version/Release補助CLIの直接起動判定もNode24.0で動作する。直接実行時に検査と終了コードを処理し、テスト等からimportした場合はCLI処理を実行しない。
隣接テスト`CLI compares the specified base package and fails closed for a missing base`と`runs the manifest CLI with Node native TypeScript and blocks publication outside main push`で実処理・生成結果・失敗終了を確認し、各`does not run the ... CLI when imported by a module or eval`でimport時の非実行を確認する。
各開発ツールのバージョンは `package.json` と `pnpm-lock.yaml` で固定する。

## 検査

`pnpm check` で次の検査をローカルとCIから実行する。

- oxfmtによる整形検査
- oxlintによるlint
- TypeScriptによる型検査
- Vitestによる振る舞いと、ビルドしたCLIの実行テスト
- ビルド
- 本CLIによる自身の関連グループの検査

実行テストでは、ビルド結果のdistとアプリ自身のpackage.jsonを一時ディレクトリへコピーし、pnpmやnode_modulesを使わずNode.jsから起動する。
製品CIはLinux・macOS・Windows、Node.js 24・26で実行する。
Git/GitHub運用の検査は既存の `sh script/check-git.sh` で別途実行する。
pre-commitはステージ済みの内容を取り出して整形・lintを検査し、そのツリー外のruntimeにビルドしたCLIで確認状態を検査する。型解決用に注入したnode_modulesはリンク自身をunlinkして実行前に外し、共有する参照先とstageされた実ファイルは保持する。
index mode 120000はcheckoutの一回だけcore.symlinks=trueで再現し、型とindex blobのtargetを照合する。利用者の設定や元index/worktreeは変更せず、再現不能はSTAGED_REFERENCE_UNSUPPORTEDとmode/path/blobの文脈で止める。core.symlinks=falseで作られる通常ファイルの本文を、意図したlink targetの内容と取り違えない。
glob利用グループは混在する個別指定も含めindex内で再現できる参照に限定し、既存の静的外部参照はライブFS依存という保証境界を維持する。
`pnpm test` では実際のGitフックを使い、部分ステージ・確認記録のステージ漏れ・古い生成物・検査不能・一時ファイルの後片付けも検証する。
詳しい動作と失敗時の対応は[Git / GitHubの開発運用](../../CONTRIBUTING.md#フックとci)を参照する。

## 選択理由

JSONを保存形式とすることで、実行時のパーサー依存を追加せず、グループ単位で差分を確認できる。
引数解析、SHA-256、ファイル操作もNode.js標準機能を使う。
TypeScriptをビルドして実行するため、Node.jsのTypeScript直接実行に対応する構文へ制限する必要がない。

関連：[利用方法](../../README.md)、[文書の管理方針](documentation.md)、[実装の責務](architecture.md)。
