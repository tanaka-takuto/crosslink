# 実装の責務と依存方向

Groupを中心に、判断ルール、操作の手順、入出力の実装を分ける。

```text
src/
  domain/                    グループと確認状態のルール
  application/               検査・登録・編集・確認の手順とポート
  infrastructure/filesystem/ JSON・ハッシュ・ファイル保存・探索
  infrastructure/version-reader.ts アプリ同梱メタデータの取得
  interfaces/html/           読取専用HTMLと内包CSS/JSへの変換
  interfaces/cli/            引数・出力・終了コードへの変換
  bootstrap.ts               実アダプターをポートへ接続
  cli.ts                     実行ファイルの入口
```

テストは各実装の隣に置く。`cli.test.ts` はビルド済み実行ファイルを外部パッケージなしで起動する。

## 各層が所有する判断

| 層             | 実装                                                                         | 責務                                                                     |
| -------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| domain         | [group.ts](../../src/domain/group.ts)                                        | 名前・理由・メンバーの条件、検査可能な構成、定義の正規化                 |
| domain         | [confirmation.ts](../../src/domain/confirmation.ts)                          | 確認記録と現在の組み合わせの比較、変更ファイルと確認状態                 |
| domain         | [errors.ts](../../src/domain/errors.ts)                                      | 共通の診断型とエラー表現                                                 |
| application    | [ports.ts](../../src/application/ports.ts)                                   | 保存・対象ファイル・設定・ハッシュ計算・アプリメタデータの外部機能の契約 |
| application    | [inspect-group.ts](../../src/application/inspect-group.ts)                   | 定義と全メンバーを取得し、ドメインの判定とsnapshotを組み立てる           |
| application    | [group-operations.ts](../../src/application/group-operations.ts)             | 明示的な登録・編集・削除・確認、保存前の検証と楽観ロック                 |
| infrastructure | [group-format.ts](../../src/infrastructure/filesystem/group-format.ts)       | JSON形式、kind・version、確認記録の構文検証                              |
| infrastructure | [management-file.ts](../../src/infrastructure/filesystem/management-file.ts) | 管理ファイルの読み込みと、関連対象から除外するファイルの識別             |
| infrastructure | [content-hash.ts](../../src/infrastructure/filesystem/content-hash.ts)       | SHA-256計算、バイト列の読み取り、読取中の変更検出                        |
| infrastructure | [group-storage.ts](../../src/infrastructure/filesystem/group-storage.ts)     | ファイル単位のロック、既存ファイルを上書きしない新規作成、置換保存       |
| infrastructure | [settings.ts](../../src/infrastructure/filesystem/settings.ts)               | 設定の既定値と検証、保存名の生成、管理ディレクトリの探索                 |
| infrastructure | [adapter.ts](../../src/infrastructure/filesystem/adapter.ts)                 | 上記の実装をapplicationのポートとして提供                                |
| interfaces     | [commands.ts](../../src/interfaces/cli/commands.ts)                          | 引数検証、操作の選択、逆引き、結果と終了コード                           |
| infrastructure | [version-reader.ts](../../src/infrastructure/version-reader.ts)              | 実行先CWDに依存せず同梱package.jsonからversionを取得                     |
| interfaces     | [output.ts](../../src/interfaces/cli/output.ts)                              | 簡潔/verboseの英語テキスト表示、全情報を持つJSON結果からの変換           |

HTMLレポートは以下の責務を追加する。

| 層             | 実装                                                                     | 責務                                                                           |
| -------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| application    | [inspection-report.ts](../../src/application/inspection-report.ts)       | check/related/reportの検査結果・診断・終了コードの共通集約                     |
| application    | [report.ts](../../src/application/report.ts)                             | 選択/探索した検査、日時・version・範囲、出力入力衝突の検証、描画と保存のポート |
| interfaces     | [html/report.ts](../../src/interfaces/html/report.ts)                    | 既存Inspectionの表示、検索・直接所属リンク、データのエスケープ、CSP            |
| interfaces     | [report-assets.ts](../../src/interfaces/html/report-assets.ts)           | 内包CSSとオフライン検索・コピーのスクリプト                                    |
| infrastructure | [report-output.ts](../../src/infrastructure/filesystem/report-output.ts) | 既存先を置換しないHTMLの新規書出し                                             |

## 依存方向と処理

`interfaces` は `application` と `domain` を参照する。
`application` は `domain` と自身が定義するポートを参照する。
`infrastructure` はそのポートを実装し、`bootstrap` が実行時に接続する。
`domain` は他の層、Node.jsのAPI、JSON保存形式に依存しない。

`application` はパスの計算にNode.jsの `node:path` を使い、ファイルI/Oはすべてポートを通す。
検査は読み取り用ポートから定義と全メンバーを取得し、ドメインへ現在の内容ハッシュを渡して判定する。
確認操作は保存用ポートのロック内で再検査し、利用者のsnapshotと一致する場合だけ記録を更新する。
検査だけで保存操作を呼ぶことはない。

version取得は `ApplicationMetadata` ポートで表し、bootstrapが `version-reader` をCLIへ接続する。
`version-reader` は自身のモジュール位置から同梱ルートの `package.json` を参照する。domainはFS・packageの知識を持たない。
SEAでは同じ相対位置の `dist/**` とルートpackage.jsonをVFSへ保持することで、この取得方法を共有できる。
検査結果の集約はapplicationの `inspection-report` が所有し、`commands` とHTML生成操作で共用する。
HTML生成操作は `ReportServices` ポートを通じて描画・新規保存・時計へ接続し、bootstrapがHTMLプレゼンターと書出しアダプターを組み合わせる。
`commands` は完全なReportを返し、`output` が通常checkの省略とverboseの詳細表示を担当する。JSONはReport全体を直接出力する。

ドメインのテストはファイルやCLIを使わず、判断ルールを直接検証する。
applicationの隣接テストは実際のファイルアダプターを組み合わせ、検査・保存・競合の手順を検証する。
保存形式・ハッシュ・ロック・探索には、それぞれinfrastructureの隣接テストを置く。

## 要件との関連付け

`.crosslink/` の各要件グループには、受入条件の判断を担う実装と、その判断を確認するテストを登録する。
例えば、確認状態は `domain/confirmation`、任意形式の扱いは `infrastructure/filesystem/content-hash`、確認記録の除外は `infrastructure/filesystem/management-file` を参照する。
一つの要件が複数の責務にまたがる場合や、同じ判断が複数要件を支える場合は、必要なファイルを各グループに登録する。
グループ名・受入条件・テスト内容から、そのファイルを同時確認する理由を説明できる構成にする。

この構成表自体は、`architecture` グループで実装・テストと関連付ける。
ファイルの分割・移動や責務の変更があれば、構成表と該当する要件グループを見直す。

関連：[文書の管理方針](documentation.md)、[開発ツール](toolchain.md)、[要件一覧](../requirements.md)。
