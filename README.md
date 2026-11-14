# crosslink

関連するファイルをグループにし、変更後の整合性確認を管理するCLIです。
現在のファイル内容が最後の確認記録と一致するかを検査します。内容の意味的な正しさを自動保証するものではありません。

## 開発・実行

Node.js 24以上とpnpm 12.18.0で開発します。推奨Node.jsは `.node-version` に記載しています。

```sh
pnpm install --frozen-lockfile
pnpm build
node dist/cli.js --help
```

ビルド後の実行にはNode.jsだけを使用します。Vitest、TypeScript、oxfmt、oxlint、pnpmは開発用です。
インストール済みの `pnpm` がない場合は `npx --yes pnpm@12.18.0` をコマンドの `pnpm` の代わりに使用できます。

## 登録から確認まで

```sh
node dist/cli.js create api docs/api.md src/api.ts --reason "API仕様と実装の整合性を確認するため"
node dist/cli.js check
node dist/cli.js related src/api.ts
```

既定では `.crosslink/api.json` に定義と最後の確認記録を保存します。
保存するJSONには `kind: "crosslink-group"` を記録し、拡張子を変えても管理ファイルとして区別します。
対象パスは管理ファイルからの相対パスで記録します。絶対パスで指定した対象は絶対パスのまま保存します。

kindのない旧形式は検査だけでは書き換えません。必要なら `node dist/cli.js migrate 管理ファイル` で移行できます。
管理ディレクトリ外の旧形式は通常JSONと区別できないため、この操作で役割を明示してください。

確認対象の内容を読んで必要な修正を終えたら、最終状態を検査してから確認します。

```sh
node dist/cli.js check --json > review.json
node dist/cli.js confirm .crosslink/api.json --snapshot review.json
node dist/cli.js check
```

未確認がある検査は終了コード1になるため、最初の検査は失敗終了する場合があります。JSONには確認対象の状態が出力されています。
`review.json` は確認操作へ渡す一時的な検査結果です。管理ディレクトリの外へ保存し、確認後は削除できます。
検査後にファイルや定義が変わった場合、古い検査結果による確認は失敗します。

一括確認は明示的に指定します。検査結果に含まれるグループだけを対象とし、不正なグループがあれば更新前に失敗します。

```sh
node dist/cli.js confirm --all --snapshot review.json
```

## グループの編集

```sh
node dist/cli.js add .crosslink/api.json src/client.ts
node dist/cli.js remove .crosslink/api.json src/old-client.ts
node dist/cli.js set .crosslink/api.json --reason "API・サーバー・クライアントを一緒に確認するため"
node dist/cli.js delete .crosslink/api.json
```

追加・削除する対象パスは、コマンドを実行したディレクトリを基準に指定します。
0・1ファイルの編集途中の状態は保存できますが、検査・CIでは不正として失敗します。
グループの構成を変更した後は、2ファイル以上へ戻してから確認し直してください。

## 設定と対象の指定

設定なしでも使えます。必要な場合、実行ディレクトリの `crosslink.config.json` に保存先とファイル名を指定します。

```json
{
  "directoryName": ".links",
  "fileNameTemplate": "group-{name}.json"
}
```

上記なら `create api` は `.links/group-api.json` を作ります。
テンプレートには `{name}` を一つ含めます。`--file` で個別の保存先を指定することもできます。

検査は実行ディレクトリ配下の管理ディレクトリを探索します。`.git`・`node_modules`とディレクトリのシンボリックリンクは探索しません。
管理ディレクトリ内のJSONはすべて管理ファイルとして扱うため、他のJSONを置かないでください。

```sh
node dist/cli.js check --file path/to/group.json --json
node dist/cli.js check --config path/to/config.json
```

## 検査結果

| 終了コード | 検査結果                                                   |
| ---------- | ---------------------------------------------------------- |
| 0          | すべて確認済み、または登録グループ0件                      |
| 1          | 未確認のグループあり                                       |
| 2          | 不正な構成、参照消失、読取不能、壊れた定義、引数エラーなど |

CLIの固定文言（help・結果・診断）は英語です。入力した名前・理由・パスはそのまま表示します。
通常の `check` は confirmed / unconfirmed / invalid の件数と、未確認・不正なグループを表示します。
確認済みグループの全ファイルは省略します。理由と全グループ・全ファイルの状態は `-v` / `--verbose` で確認します。
`-v` は verbose の略です。`--json` は表示の省略に影響されず、全情報を出力します。

```sh
node dist/cli.js check --verbose
node dist/cli.js check -v
node dist/cli.js check --json
node dist/cli.js --version
```

`--version` はcrosslink自身の `package.json` のversionだけを表示します。実行先プロジェクトのversionは参照しません。
JSONの `version: 1` は出力形式の版であり、アプリのversionとは別です。
`--` 以降はファイル名として扱うため、`--json`・`--version` などの名前のファイルも指定できます。

登録グループが0件の場合は `No registered groups.` と通知して成功します。
確認・編集などの操作は、操作が成功すれば0、失敗すれば2です。確認後の検査で新たな変更が見つかった場合は1になります。

## HTMLレポート

閲覧用の単一HTMLを、外部サービスやサーバーなしで生成できます。親ディレクトリを用意し、未使用の出力先を指定します。

```sh
mkdir -p tmp
node dist/cli.js report --format html --output tmp/review.html
node dist/cli.js report --format html --output tmp/selected.html --file .crosslink/api.json
```

生成したHTMLは手動で開きます。名前・理由・パスの検索、未確認/検査エラーの絞り込み、ファイルから直接所属するグループへの逆引きができます。
ローカルファイルへのリンクとパスのコピーを備え、別のディレクトリに保存しても元の絶対パスを指します。
他のコンピューターやブラウザーではリンクが開けないことがあるため、表示パスの選択・コピーも利用できます。

レポートは生成時点のスナップショットです。日時・crosslinkのversion・検査範囲を表示し、以後の変更には追従しません。
確認済みは内容の意味的な正しさを保証しません。HTMLからの確認・編集やファイル内容の差分表示はありません。
名前・理由・ローカルの絶対パスを含むため、共有前に生成物の内容を確認してください。

終了コードは `check` と同じく、全件確認済み/0件は0、未確認は1、不正/検査不能は2です。検査エラーがあっても描画できる結果は保存します。
既存出力や入力ファイルには上書きしません。衝突・書出し不能も2で終了し、別の出力先を指定できます。
`--file` は繰り返せ、`--config` と `--json` も使えます。詳しい契約は [HTML仕様](docs/specifications/html-report.md) を参照してください。

## このリポジトリへの適用

`.crosslink/` に、このCLI自身の要件・仕様・実装・隣接するテストを関連付けています。
変更後は `node dist/cli.js check` で確認対象を調べ、関連ファイルを確認してから記録を更新します。

```sh
pnpm check
```

型検査、整形検査、lint、テスト、ビルド、自身の関連グループの検査を実行します。
製品の検査はCIでLinux・macOS・Windows、Node.js 24・26を対象に実行します。

詳細：[要件一覧](docs/requirements.md)、[CLI仕様](docs/specifications/cli.md)、[保存形式](docs/specifications/storage.md)、[開発ツール](docs/development/toolchain.md)、[実装の責務と依存方向](docs/development/architecture.md)。
