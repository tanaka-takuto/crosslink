# 開発ツールと実行環境

実装はTypeScript、テストはVitest、パッケージ管理はpnpm、整形はoxfmt、lintはoxlintを使う。
テストは対応する実装の隣へ `domain/group.ts`・`domain/group.test.ts` のように置く。
TypeScriptで型検査し、JavaScriptのES Modulesへビルドする。テストは実行用ビルドから除外する。

ビルド後のCLIに実行時の外部パッケージはない。Node.js 24以上の標準機能だけを使用する。
開発用の推奨Node.jsは `.node-version`、pnpmは `package.json` の `packageManager` で固定する。
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
pre-commitはステージ済みの内容を取り出して整形・lintを検査し、そこからビルドしたCLIで確認状態を検査する。
`pnpm test` では実際のGitフックを使い、部分ステージ・確認記録のステージ漏れ・古い生成物・検査不能・一時ファイルの後片付けも検証する。
詳しい動作と失敗時の対応は[Git / GitHubの開発運用](../../CONTRIBUTING.md#フックとci)を参照する。

## 選択理由

JSONを保存形式とすることで、実行時のパーサー依存を追加せず、グループ単位で差分を確認できる。
引数解析、SHA-256、ファイル操作もNode.js標準機能を使う。
TypeScriptをビルドして実行するため、Node.jsのTypeScript直接実行に対応する構文へ制限する必要がない。

関連：[利用方法](../../README.md)、[文書の管理方針](documentation.md)、[実装の責務](architecture.md)。
