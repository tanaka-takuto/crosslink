# versionとGitHub Release

[Issue #17](https://github.com/tanaka-takuto/crosslink/issues/17) に基づく配布・検査の運用。
配布先はGitHub Releasesで、npmへは公開しない。`package.json` の `private: true` を維持する。

## versionの検査

main向けPRでは `package.json` のversionをbase commitから変更する。
`MAJOR.MINOR.PATCH` と任意のprerelease/build metadataは [SemVer 2.0.0](https://semver.org/) に従う。
数値識別子の先頭ゼロ、空の識別子、`v` 接頭辞、末尾改行などは拒否する。build metadataの数値の先頭ゼロは許可する。
比較はversion文字列の相違だけを要求し、増分やmajor/minor/patchの選び方は追加制約にしない。
main pushでは直前のcommitとの相違も検査する。baseを取得できなければ失敗させる。

```sh
pnpm check:version --base <baseの完全なcommit SHA>
pnpm check:release
```

`pnpm check:version` 単体は現在の形式とprivateを検査し、`--base` 指定時は差分も検査する。
`pnpm check` にも、version/Releaseスクリプトの型・lint・Vitestによる検査を含める。
GitHub Actionsの `Version policy`・6環境の通常検査・3環境のSEA検査がすべて成功しない限り、既存必須check `CLI policy` は失敗する。
rulesetの必須check名は `Git policy`・`PR policy`・`CLI policy` のままで、GitHubの設定変更は不要。

## main pushによる公開

`.github/workflows/cli-policy.yml` 内で検査から公開までを同じrunにまとめる。
PRとworkflow_dispatchでは公開せず、mainへのpushだけで実行する。初回の本番公開もmainへマージしたpushで自動実行する。

1. そのrunのcheckout SHAでNode.js 24/26の通常検査をLinux・macOS・Windowsに対して実行する。
2. [VFSを使えるNode.js 26.13.1](https://nodejs.org/api/single-executable-applications.html) で `pnpm build:binary` と `pnpm test:binary` を3環境とも実行する。
3. 実際の `process.platform` / `process.arch`、version、`GITHUB_SHA`、binary/checksumのSHA-256をmanifestへ記録し、同じrunのartifactへ保存する。
4. mainで追加されたコミットとGitフックをLinux/macOSで再検査する。公開は別workflowの通知や別SHAのstatusに依存しない。
5. `CLI policy` と上記Git検査が成功したときだけ、公開jobが同じrunのartifactをダウンロードする。全manifestのSHA/version/target、6ファイルとchecksum、過不足を検査する。
6. `v<version>` のtagがあればcommitまで解決してSHAを照合する。なければ検査済みSHAに新規tagを作り、[GitHub公式のgenerate-notes API](https://docs.github.com/en/rest/releases/releases#generate-release-notes-content-for-a-release) の本文からdraft Releaseを作る。
7. binaryと `.sha256` を合計6個添付し、取得し直したファイルのサイズ・SHA-256・upload状態を照合する。tagのSHAを再検査してからdraftを公開する。

既定のtokenは `contents: read` のみ。公開jobだけ `contents: write` を持ち、checkoutに認証情報を残さない。
すべての外部Actionは完全commit SHAで固定する。`pnpm check` と通常の `pnpm test` にSEA生成を含めず、Node.js 24を維持する。

| runner       | 検証する実platform/arch | Releaseのファイル名                    |
| ------------ | ----------------------- | -------------------------------------- |
| ubuntu-24.04 | linux / x64             | `crosslink-linux-x64` と `.sha256`     |
| macos-15     | darwin / arm64          | `crosslink-darwin-arm64` と `.sha256`  |
| windows-2025 | win32 / x64             | `crosslink-win32-x64.exe` と `.sha256` |

runnerの構成は [GitHub公式一覧](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) で確認した。
ファイル名へrunnerから推測したarchを埋め込まず、Node.jsが報告する実際の値を使う。対象外の組合せや3対象の欠落は公開を失敗させる。
Node.jsのSEA公式資料ではmacOSのCI検証対象はARM64。Intel macOS向け配布はこの構成には含めない。

main pushのconcurrency groupは `github.run_id` を含み、異なるpushを打ち切らない。
`cancel-in-progress: false` だけでは同じgroupのpending runが置換されるため、main共通のgroupにはしない。
参照: [GitHubのconcurrency仕様](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。
prerelease識別子があるversionはprereleaseにし、build metadataのハイフンとは区別する。
latestの選定はGitHubの `make_latest: legacy` に委ねるため、古いpushの終了が遅れても無条件にlatestへ指定しない。

## 再実行と停止時の扱い

- tagが別SHAを指す場合は、tagの移動・削除もReleaseの変更もせず失敗する。
- 同SHAの公開済みReleaseは、生成時のSHA記録と全6assetの実データが一致するときだけ変更せず成功する。
- 同SHAのdraftは既存assetを先に照合し、不足分だけアップロードして検査後に公開する。既存ファイルは上書きしない。
- assetの内容・名前・状態・数、ReleaseのSHA記録が違う場合、または公開済みReleaseが不足している場合は失敗する。
- 通信失敗・アップロード失敗・tag照合失敗なら公開しない。draftや新規tagが残ることはあり、失敗を成功扱いしない。
- HTTP 502による `starter` asset、同SHAでも再ビルド結果が異なる場合、別runとの競合は自動削除や上書きをしない。ログとGitHub上のSHA/assetを調査し、コーディネーターへ復旧を依頼する。

同SHAであっても全OSの再ビルド結果が同じになる保証はない。検証済みartifactが残っている14日以内なら、通常は同じmain runの「Re-run failed jobs」で公開jobを再実行する。
artifact保持期限を過ぎた場合、再ビルドの結果が既存assetと違えば公開処理は停止する。
手動のRelease作成・tag付け替え・asset上書きを通常の復旧手順にしない。

## 受入条件と検証の対応

| 条件                                           | 検証                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SemVer2の有効/不正、base未変更、private維持    | `SemVer 2.0.0 and base comparison` 内の各テスト                                                                                                                                                                                                                                                                                                   |
| 指定base取得失敗を成功扱いしない               | `CLI compares the specified base package and fails closed for a missing base`                                                                                                                                                                                                                                                                     |
| 3環境と同一SHAの成果物だけ公開                 | `rejects a mismatched manifest before creating a tag or release` / `rejects a bad checksum or incomplete platform set before any remote write` と実SEA CI                                                                                                                                                                                         |
| notesを生成し、assetが揃うまでdraft            | `publishes only after six assets are uploaded and verified, using generated notes and the exact SHA`                                                                                                                                                                                                                                              |
| 公開済み再実行とdraft再開、上書き拒否          | `verifies a published same-SHA rerun without uploads or republishing` / `resumes a partial same-SHA draft without replacing existing assets` / `refuses changed bytes on a same-SHA rerun without overwriting`                                                                                                                                    |
| tag移動・通信失敗・途中assetで公開停止         | `rejects a tag pointing to another SHA without remote writes` / `detects a moved tag again before publishing` / `rechecks the tag after verifying an already-published same-SHA release` / `leaves a failed upload in draft instead of publishing a partial release` / `rejects a starter asset after an interrupted upload without replacing it` |
| PRから公開しない                               | workflowのjob条件・権限検査と `runs the manifest CLI with Node native TypeScript and blocks publication outside main push`                                                                                                                                                                                                                        |
| version/SEAの失敗を必須ゲートへ伝播            | `CLI policy` のneeds/成功条件、actionlint、失敗条件の実行確認、実PR CI                                                                                                                                                                                                                                                                            |
| 実際のmain pushでtag・SHA・6asset・notesを確認 | main統合後のGitHub Actions/Release。ローカルテストでは代用しない                                                                                                                                                                                                                                                                                  |

確認記録の更新は最終ファイルを検査し、提示された関連グループを確認した後に行う。
ローカルのテスト成功、workflow構文検査、crosslinkの確認記録は、本番Releaseの実行済み証拠にはならない。
