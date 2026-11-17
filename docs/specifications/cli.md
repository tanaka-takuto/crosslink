# CLIの操作と出力

`node dist/cli.js` で実行する。`--help` で利用可能な操作を表示する。
設定・対象ファイルはローカルから読み、Gitや外部サービスに接続しない。

## 操作

| 操作                                          | 内容                                                 |
| --------------------------------------------- | ---------------------------------------------------- |
| create 名前 対象... --reason 理由             | グループを新規作成。--fileで保存先も指定できる       |
| add 管理ファイル 対象...                      | メンバー追加                                         |
| remove 管理ファイル 対象...                   | メンバー削除。消失したファイルも登録から外せる       |
| set 管理ファイル --name 名前 / --reason 理由  | 名前・理由を更新                                     |
| delete 管理ファイル                           | グループを削除。関連ファイルは削除しない             |
| migrate 管理ファイル                          | 旧形式へ管理ファイルの種別宣言を追加。確認記録は保持 |
| check                                         | グループの定義・確認状態を検査                       |
| report --format html --output 出力先          | 閲覧用の単一HTMLを保存する                           |
| related 対象ファイル                          | 直接関連するグループと全構成ファイルを提示           |
| confirm 管理ファイル --snapshot 検査結果.json | 一つのグループを明示確認                             |
| confirm --all --snapshot 検査結果.json        | 検査結果に含まれる全グループを明示確認               |

`check`・`related`・`report` は `--file` を繰り返して対象を指定できる。指定がなければ実行ディレクトリ配下を探索する。
探索では `.git`・`node_modules`・ディレクトリのシンボリックリンクをたどらない。
管理ディレクトリ・管理JSONのシンボリックリンクを見つけた場合はエラーとし、0グループ扱いで成功させない。
`--config` は任意の設定ファイル、`--json` は機械・AI共通のJSON出力を指定する。
`check -v` / `check --verbose` は人間向けの詳細表示を指定する。`-v` はverboseの略で、versionではない。
`--version` はcrosslink自身の同梱 `package.json` のversionだけを改行付きで表示し、0で終了する。
実行先CWDの `package.json` や設定には依存しない。通常実行とSEAで同じ同梱版を参照する。
`--version --json` は `operation: "version"`、`messages: ["アプリversion"]` を含む通常のJSON形式で返す。
`--version` にコマンドや `--config` は併用できない。`--help` があればhelpを優先する。
`--` 以降の引数はオプションと解釈しない。例えば `create flags --reason review -- --verbose --version` は2つのファイル名を登録する。

## HTMLレポート

`report --format html --output <path>` は必須オプションをそれぞれ一回指定する。
`--file` の繰り返し・`--config`・`--json` を使える。位置引数と `--verbose` は使えない。
対象の検査結果を単一HTMLへ保存し、既存ファイルには上書きしない。出力先の親ディレクトリは自動作成しない。
未確認は1、検査不能や書出し不能は2で終了するが、描画可能な検査エラーはHTMLに残す。
詳しい表示・引数・安全性は [HTML仕様](html-report.md)、受入条件は [HTML要件](../requirements/html-report.md) を参照する。

## 人間向け出力

固定文言（help、成功・失敗、状態、診断）は英語とする。利用者の名前・理由・パスは変更しない。

通常の `check` は `Groups: N confirmed, N unconfirmed, N invalid.` の件数を表示し、
未確認・不正なグループの名前と管理ファイルを `Unconfirmed:` / `Invalid:` で列挙する。
確認済みグループの名前・理由・構成ファイルは省略する。要確認があれば詳細は `--verbose` で取得できる旨を案内する。
不正グループは未確認の件数へ重複計上しない。構成不正や検査不能の詳細診断は標準エラーへ出す。

`check -v` / `check --verbose` は件数に加え、確認済みも含む全グループ・理由・全構成ファイルを表示する。
状態は `Confirmed` / `Unconfirmed` / `Invalid`、理由は `Reason`、ファイルは `New` / `Changed` / `Unchanged` と表示する。
`New` は比較元の確認記録がない状態を示す。`related` と保存後・確認後の表示は詳細形式のままとする。
グループ0件は `No registered groups.`、逆引き0件は `No groups are related to this file.` と通知する。

## JSON出力

標準出力へ一つのJSONオブジェクトだけを出力する。エラーもJSONに含める。
通常表示では、結果を標準出力、エラー診断を標準エラーへ出す。
`--json` は簡潔表示・verbose指定にかかわらず、全グループ・理由・全構成ファイル・ハッシュ・snapshot・エラーを保持する。
以下の `version: 1` は出力形式の版であり、`--version` のアプリversionと混同しない。

| 項目      | 内容                          |
| --------- | ----------------------------- |
| version   | 出力形式のバージョン。現在は1 |
| operation | 実行した操作                  |
| result    | ok / unconfirmed / error      |
| groups    | 対象グループの情報            |
| errors    | 操作全体のエラーコードと説明  |
| messages  | 登録グループ0件などの通知     |

各グループは、管理ファイルの絶対パス、名前、理由、確認状態、全構成ファイル、検査結果のsnapshot、エラーを持つ。
構成ファイルは登録パス・現在のハッシュ・最後の確認から変更されたかを持つ。
比較元の確認記録がなければ変更判定はnull、読めないファイルのハッシュもnullとする。
確認状態はconfirmed / unconfirmedの2つ。構成不正・検査不能はerrorsで区別する。

## 診断の次の行動

既存の診断messageに、原因・対象に合う英語の対処手順を添える。テキストとJSONのmessageは同じ案内を持ち、
JSONの項目構造・version、エラーコード・終了コード・確認状態の判定は変えない。
通常checkの件数・対象一覧・verboseへの案内は維持する。詳細の診断messageは標準エラーとverbose表示、またはJSONで取得する。

| 対象                   | 案内する次の行動                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| 古い・不正なsnapshot   | `check --json` で再検査し、全関連内容を読み直してから新しい検査結果で明示確認する               |
| 対象消失・読取不能     | 存在・読取権限を確認し、復元、移動時の登録パス変更、意図した削除時の登録解除を検討する          |
| 通常ファイル以外の対象 | 登録パスを通常ファイルへ修正し、再検査する                                                      |
| 0・1ファイル           | 現在の件数と最低2件を示し、メンバー追加・再検査・全関連内容の読み直しを確認操作より先に案内する |
| 壊れた管理JSON等       | 管理JSON・定義・確認記録を修復または有効なコピーから復元し、再検査する                          |
| 未対応の管理version    | 対応するcrosslink版または対応形式のコピーを利用し、再検査する                                   |
| 不正グループの確認     | `check --verbose` で問題を特定・修復し、全関連内容を読んでから明示確認する                      |
| ロック                 | 更新が実行中でないことを確認してからロックを点検する既存案内を維持する。自動解除しない          |

診断だけで対象ファイル・確認記録・ロックを修復・更新しない。利用者の名前・理由・パスは保持する。
パス等を埋め込んだ実行コマンドは生成せず、一般的な手順として示す。新たなコマンド・フラグ・実行時依存は追加しない。

## 終了コード

検査・逆引き・確認後の検査では、全対象が確認済みなら0、未確認があれば1、不正・処理不能なら2。
登録グループ0件は通知して0とする。登録済みグループが0・1ファイルの場合は2。
登録・編集・削除では、保存できれば0、操作に失敗すれば2。編集途中の0・1件を保存した場合も、編集操作自体は成功する。

## 確認操作と競合

検査のJSONをファイルに保存し、対象の内容を確認した後、`confirm` へ渡す。
snapshotは、管理ファイルのパスと内容、全対象ファイルのハッシュを結び付けた値である。
現在の状態が検査結果と一致しない場合や、対象に不正がある場合は記録を更新しない。

CLIの更新は管理ファイル単位の短時間のロックで保護する。既存ロックがあれば自動解除せずエラーにする。
ロックを残してプロセスが停止した場合は、更新が実行中でないことを確認してから、表示された `.lock` ファイルを手動で除く。
更新中の管理JSONへの直接編集は避ける。通常ファイルの変更を常時ロックする機能ではない。

一括確認は全対象の検査・snapshot照合を更新前に行う。不一致や不正があれば一件も更新しない。
保存はファイルごとに置換するため、I/Oエラーやプロセス停止をまたぐ複数ファイルのトランザクションは保証しない。
書込エラーでは更新済みの対象を診断へ含める。再検査で現在の状態を確認する。

関連：[明示確認の要件](../requirements/explicit-confirmation.md)、[自動検査の要件](../requirements/check.md)、[AIからの利用](../requirements/agent-usage.md)。

英語表示・verbose・versionの決定：[Issue #15](https://github.com/tanaka-takuto/crosslink/issues/15)。
診断案内の決定：[Issue #20](https://github.com/tanaka-takuto/crosslink/issues/20)。

## 動的なglob選択

```sh
crosslink create adr docs/design.md --glob 'docs/adr/**/*.md' --reason 'Review the design and ADRs together'
crosslink add .crosslink/adr.json --glob 'docs/decisions/*.md'
crosslink remove .crosslink/adr.json --glob 'docs/decisions/*.md'
```

create/add/removeは`--glob`を繰り返せる。個別指定と同時に使え、globだけの作成・編集もできる。
入力はCWD、保存は管理ファイル基準。シェル展開を避けるためパターンを引用する。`--`以降は個別パスであり、globと推測しない。
removeの個別パスはfiles内の登録だけを外す。glob由来だけのパスに個別removeを使うと`NOT_A_MEMBER`で拒否し、パターンの変形や除外規則を作らない。
`--glob`によるremoveは変換後に同じ選択文字列で登録されているパターンを外す。一致結果が同じ別パターンを推測して外さない。
各globが0一致、または全実メンバー2件未満でも編集自体は保存できる。check/confirmは拒否する。

通常checkの件数表示は維持する。詳細表示は`Glob`、初回は`No baseline`、新規一致は`Added`、旧一致の消失は`Removed`を提示する。
現在のfilesは現メンバーだけを保持し、removedは別配列とする。relatedは現在のメンバーを逆引きし、最後の確認から外れたパスも履歴上の直接関連として提示する。removedは現在の所属とは呼ばない。これらを直接逆引きする（グループ間の伝搬はしない）。

JSON topのversionは1のまま。globの選択・増減項目はglob利用グループだけに互換な追加項目として付ける。

| 項目               | 内容                                                         |
| ------------------ | ------------------------------------------------------------ |
| globs              | 選択パターン配列（管理ファイル基準）                         |
| added              | 最後の確認にない現在のパス配列。初回・探索不完全はnull       |
| removed            | 現集合にない前回の`{path, hash}`配列。初回・探索不完全はnull |
| membershipComplete | 選択範囲の展開が完了したか。ファイル内容の可読性とは別       |

既存filesのpath/hash/changedは維持する。addedのchangedはtrue、比較元なしはnull。removedのhashは最後の確認値で、現在のハッシュではない。
0一致は展開完了でも検査エラー。探索途中失敗や集合変化では増減を断定せずnullとする。個別消失は従来のFILE_UNREADABLE。
snapshotは定義のraw、管理ファイルのパス、展開後の全パスとハッシュを結び付ける。確認操作で再検査し、追加・削除・renameも旧snapshotとして拒否する。

管理定義の初回読取/解釈、または最終raw再確認が失敗したグループには、static/dynamicとも任意項目`definitionVerified: false`を追加する。通常はこの項目を省略し、省略を原子的なFS保証とは扱わない。`membershipComplete`は選択範囲の列挙可否であり、定義再検証の可否とは別である。最終定義再確認失敗時はsnapshotを発行せず、収集した理由/パス/内容比較と診断は残すが、globの`added`/`removed`はnullとする。verbose/relatedは定義を検証できず現在メンバー一覧が不完全になりうる旨を表示する。通常のメンバー内容だけFILE_UNREADABLEの場合はこの項目を付けず、既知のパス集合を維持する。
構文・安全境界は[glob選択仕様](glob-selection.md)、要件は[動的集合](../requirements/dynamic-membership.md)を参照する。

## 開発用pre-commitと動的参照

pre-commitはindexのツリーを取り出し、その外のruntimeに同じstagedソースのCLIとpackage.jsonをビルドする。
indexのmodeとblobを読み、mode120000は一回限りの`git -c core.symlinks=true checkout-index`で実symlinkとして取り出す。型とtargetを検証し、空/NULなど表現不能なtargetやcheckout失敗を`STAGED_REFERENCE_UNSUPPORTED`とmode/path/blobの文脈で拒否する。POSIXではtarget bytes、Windowsでは区切り/absolute表現を含む解決先の同一性を照合する。利用者のcore.symlinks設定を変更しない。内部file linkとstatic-only外部file linkを許容し、directory linkへは降りない。
型解決に注入したnode_modulesリンクだけをCLI検査前に取り除く。ユーザーがstageしたdistやnode_modulesの実ファイルを検査用生成物と混同して削除しない。
非空globsを持つグループでは、混在する固定filesも含め全参照をindexツリー内で再現できることを要求する。
絶対glob、リポジトリ外へ出る相対glob、絶対/外部の個別指定、外部を指すメンバーsymlinkは`STAGED_REFERENCE_UNSUPPORTED`でコミットを拒否し、修正・再検査・再確認を案内する。
通常CLIの絶対/外部参照は引き続き使える。既存の静的グループはhookでも従来の外部固定参照を維持し、その参照先はライブFSに依存する。この場合に全参照をindexのみで検査できたとは保証しない。
