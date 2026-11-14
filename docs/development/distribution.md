# 単一実行ファイルの配布

[Issue #16](https://github.com/tanaka-takuto/crosslink/issues/16) で採用したNode.js標準SEAを使う。
配布する実行ファイルにはNodeランタイムとアプリのES Modulesを同梱し、利用先のNode.js・pnpm・node_modulesを不要にする。
ソースからの開発実行は従来どおりNode.js 24以上を使う。npmへは公開せず、`package.json` の `private: true` を維持する。

## ビルド

`.node-version` と一致するNode.js 26.13.1、pnpm 12.18.0、開発依存を用意する。
macOSでは `/usr/bin/codesign` も必要になる。OS・CPUごとに、その環境のNode.jsでビルドする。クロスコンパイルは行わない。

```sh
pnpm install --frozen-lockfile
pnpm build:binary
pnpm test:binary
```

`build:binary` はTypeScriptをビルド後、`script/build-binary.ts` からNode標準の `--build-sea` を実行する。
外部バンドラー、postject、実行時npmパッケージを使用しない。
`tmp/bin/crosslink-<process.platform>-<process.arch>[.exe]` と、そのファイル名に `.sha256` を付けたファイルを生成する。
Windowsは `crosslink-win32-x64.exe` のように `.exe` を必ず付ける。
ビルド結果のJSONにはパス、OS、CPU、Nodeバージョン、バイト数、SHA-256を出力する。
再ビルド時は同名の旧成果物を削除し、生成・署名・ハッシュのいずれかに失敗した場合も未完成の成果物を残さない。
Nodeバージョンの不一致は生成を始める前に拒否する。

SEA設定は `mainFormat: "module"`、`useVfs: true`、`useCodeCache: false`、`useSnapshot: false` とする。
VFSのルートにアプリ自身の `package.json`、その下の `dist/` にビルド結果の全階層を保持する。
ルートの小さなラッパーから `./dist/cli.js` をimportするため、通常実行と同じ相対パスでアプリのバージョンを参照できる。
VFSのパスを利用先へ展開する処理はない。設定・管理JSON・対象ファイルは、従来どおり実行時の作業ディレクトリに対して読み書きする。

macOSでは実行権限を `0755` にし、アドホック署名を行う。LinuxなどWindows以外も `0755` にする。
macOSのアドホック署名はDeveloper ID署名・公証ではない。Windowsの証明書による署名もこのビルダーでは行わない。
ハッシュは署名を含めた最終バイト列から計算し、`<SHA-256>  <実行ファイル名>` の形式で保存する。
署名を後から変更した場合は、ハッシュの再生成と実バイナリの再検証が必要になる。
SEA/VFSはNode.jsで開発中の機能なので、Nodeの更新時にも実バイナリを再検証する。

## 利用先での実行

[GitHub Releases](https://github.com/tanaka-takuto/crosslink/releases) で、自分のOS・CPUに対応する実行ファイルと同名の `.sha256` を取得する。
公開済みの組み合わせは各ReleaseのAssetsで確認する。該当する成果物がない場合は上の手順でビルドする。
macOS ARM64の場合は、ダウンロードした2ファイルを同じディレクトリに置いて検証する。

```sh
shasum -a 256 -c crosslink-darwin-arm64.sha256
chmod +x crosslink-darwin-arm64
./crosslink-darwin-arm64 --help
```

Linuxでは `sha256sum -c crosslink-linux-x64.sha256` を使用できる。
Windows PowerShellでは `Get-FileHash .\crosslink-win32-x64.exe -Algorithm SHA256` のHashを `.sha256` の先頭の値と比較し、`.\crosslink-win32-x64.exe --help` で実行する。
任意の名前へ変更してPATHの通った場所へ置く場合、Windowsでは `.exe` を保持する。
検証済みの実行ファイルだけを移動すればよく、ソース、dist、package.json、node_modulesの配置は不要である。
チェックサムは配布ファイルとの一致を検査するもので、発行元の署名の代わりにはならない。

## 実バイナリの検証

`pnpm test:binary` は現在のソースからビルドし直し、ビルダーとテストの型検査、隣接する `script/build-binary.test.ts` のVitestテストを実行する。
通常の `pnpm test` / `pnpm check` はこのSEA専用テストを含まず、Node.js 24でも実行できる。
リリース候補では通常検査に加えて、対象OS・CPUで `pnpm test:binary` を実行する。
一つの環境での合格は他のOS・CPUの実行確認を保証しない。
helpの固定文言は英語で、通常checkは状態別の件数を表示する。`check --verbose` / `check -v` では利用者の名前・理由・全ファイルを保持する。
`--version` は実行先にpackage.jsonがない場合も、別versionのpackage.jsonや壊れた設定がある場合も、同梱したアプリのversionを表示する。

| 検証する契約                                                                | 対応するテスト名                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| OS/CPU別のファイル名とWindowsの拡張子                                       | `names native artifacts by OS/CPU and gives Windows an exe suffix`                         |
| 最終バイト列のSHA-256、Unixの実行権限、macOS署名                            | `ships a checksum of the final executable and native execution permissions`                |
| 実行ファイルだけを持ち出し、空のPATHで英語helpを起動                        | `runs English help with only the executable and an empty PATH`                             |
| 実行先に別versionのpackage.json・壊れた設定があっても同梱versionを表示      | `reports its bundled version even when the working directory has a different package.json` |
| 実ファイルの登録・検査・確認・変更検知・古いsnapshot拒否、通常/verbose/JSON | `creates, checks, confirms and detects changes on the real working filesystem`             |
| 引数エラーの終了コード2とJSON標準出力                                       | `keeps invocation errors as one JSON object on stdout without Node`                        |

実行用fixtureはOSの一時ディレクトリへ置き、テスト後に削除する。リポジトリ内の検査対象探索へ試験用管理グループを混ぜない。

参考：[Node.js 26.13.1 SEA公式資料](https://nodejs.org/api/single-executable-applications.html)、[利用方法](../../README.md)、[開発ツール](toolchain.md)、[CLI仕様](../specifications/cli.md)。
