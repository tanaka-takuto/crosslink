# globによる動的な関連ファイル集合

## 要求

正本設計書と増え続けるADRなどを一緒に確認し、ファイルが増減するたびに個別登録する作業を減らしたい。
内容が同じファイルの追加や名前変更も、前回の確認とは異なる組み合わせとして把握したい。
合意の根拠は [Issue #26](https://github.com/tanaka-takuto/crosslink/issues/26)。

## 要件

- リテラルの個別指定と、永続化したglobを併用する。既存files中のメタ文字をglobと推測しない。
- 検査ごとにglobを展開する。最低2件は重複しない実ファイルの件数で判定し、各globが0一致ならほかに固定ファイルがあっても検査を失敗させる。0/1件や0一致の定義は保存できる。
- 重なるglobと個別指定の同じパスを一つにする。個別指定同士の重複、別パスが同じrealpathを参照する重複はエラーとする。
- 確認済みには、選択定義・現在の全パス集合・各内容ハッシュの一致を必要とする。同内容の追加・renameも未確認になる。
- 以前globに一致して現在は外れたパスをremoved、新しく一致したパスをaddedとして提示する。renameは削除と追加で表す。初回の比較元なしと区別する。
- 個別指定の消失は従来どおり検査不能とする。globからの通常削除では、有効な構成が残れば新しい集合を明示確認できる。
- 検査時と確認時に再展開し、途中の集合・内容変更や古いsnapshotを拒否する。失敗では確認記録を更新しない。検査だけでは定義・記録・対象を書き換えない。
- 内容とパス集合を最後の確認へ完全に戻すと確認済みに戻る。イベント履歴・常駐watch・Git・ネットワークを必要としない。
- ディレクトリをメンバーにせず、ディレクトリsymlinkへ降りない。通常ファイルsymlinkは従来どおり参照先を読む。管理ファイルへの一致は検査エラーとし、探索・読取エラーを0一致や成功へ丸めない。
- 通常checkの簡潔さとJSONのtop version1を維持する。詳細・JSON・related・HTMLでパターン、現在の全対象、増減を提示する。HTMLのFile indexには現在のメンバーだけを含める。
- 実行時はNode標準のみを使う。Node24の初版でも利用できるAPIを使い、除外指定・regexは追加しない。全ファイルシステム操作の原子的なロックは保証しない。

## 受入条件とテスト

| 受入条件                                                          | 具体テスト名（隣接テスト）                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 登録編集・同内容追加・rename・範囲外移動・再確認後の変更・復元    | `persists quoted glob selectors and tracks same-content additions, renames and removals` (commands.test.ts)                                                                                                                                                                               |
| 明示的なglob編集、個別removeが選択を変形しない                    | `edits selectors explicitly without changing glob membership through literal remove` (commands.test.ts)                                                                                                                                                                                   |
| 重なる選択・symlink alias禁止・hardlink既存互換・管理ファイル禁止 | `deduplicates overlapping selector paths, rejects symlink aliases and preserves hardlink compatibility`, `rejects management records selected by globs including kind declarations and aliases` (group-operations.test.ts)                                                                |
| 各globの0一致、実メンバー0/1件、確認拒否                          | `rejects one zero-match glob even with two literal members` (inspect-group.test.ts), `saves %i expanded files but refuses inspection and confirmation` (group-operations.test.ts)                                                                                                         |
| 追加・削除・rename・内容・定義変更後の旧snapshotと保存不変        | `rejects a stale dynamic snapshot after %s without updating records` (group-operations.test.ts)                                                                                                                                                                                           |
| 読取り中の集合/内容/参照先変更                                    | `refuses membership changes during hashing instead of emitting a snapshot` (inspect-group.test.ts), `detects a previously hashed file changing during a dynamic inspection` (group-operations.test.ts)                                                                                    |
| 通常ファイルsymlink、ディレクトリsymlink、権限・壊れたlink        | `keeps regular file symlinks and skips directory symlinks including cycles and literal directory segments`, `surfaces traversal permission failures that native glob suppresses`, `reports a broken file symlink rather than silently succeeding` (glob-members.test.ts)                  |
| リテラルメタ文字、旧形式・旧確認                                  | `keeps metacharacters in literal file names without glob expansion` (group-operations.test.ts), `migration preserves the old confirmation rather than approving later content changes` (commands.test.ts)                                                                                 |
| Node単独・別CWD・任意形式・Gitなし・シェル展開なし                | `runs dynamic membership with only Node, from another CWD and without Git or shell expansion` (cli.test.ts)                                                                                                                                                                               |
| Windows/UNCパス                                                   | `preserves Windows absolute and UNC roots and stores portable slash patterns` (member-path.test.ts)                                                                                                                                                                                       |
| 簡潔text・全詳細・HTML現在集合/removed分離、不完全検査            | `shows selectors, added and removed paths while keeping compact check concise` (output.test.ts), `separates glob selections and removed baseline paths from current members and file index`, `labels incomplete glob membership without asserting additions or removals` (report.test.ts) |
| 検査対象やglob一致先へのHTML書出し拒否                            | `does not create a report at a removed baseline path or a new matching glob path` (application/report.test.ts)                                                                                                                                                                            |
| SEA単独/空PATHの追加・削除・rename・確認/拒否・HTML               | `tracks glob additions, deletion and same-content rename with SEA alone and an empty PATH` (build-binary.test.ts)                                                                                                                                                                         |
| staged新CLIによる集合増減拒否・未ステージ隔離                     | `glob一致集合はステージ済み内容だけで検査し、追加・削除を古い確認で通さない` (check-staged.test.mjs)                                                                                                                                                                                      |

テストの成功は文言の視認性・実ブラウザー操作の合格を代用しない。生成HTMLは最終候補SHAとhashを固定し、実装者と別のUI/UXレビューで確認する。
仕様：[選択構文](../specifications/glob-selection.md)、[保存](../specifications/storage.md)、[CLI](../specifications/cli.md)、[HTML](../specifications/html-report.md)。

追加の監査受入条件：

| 条件                                                                | テスト                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全OSでcase-sensitive、EIO/ENOTDIRを0一致にしない                    | `matches filename case identically on every OS instead of native macOS nocase`, `propagates EIO from strict enumeration even after other matches were found`, `distinguishes a non-directory literal prefix from zero matches` (glob-members.test.ts)                                   |
| 制限文法、文字クラス、CWD変換前の不正入力                           | `matches a portable case-sensitive glob grammar with literal regex punctuation`, `rejects invalid classes and parent traversal after wildcards explicitly` (glob.test.ts), `rejects empty, unsupported and ambiguous glob syntax before converting from CWD` (commands.test.ts)         |
| 一括の後続検査中に先行集合が変化したら保存0                         | `revalidates every prepared group before batch writes when a later inspection changes an earlier set` (group-operations.test.ts)                                                                                                                                                        |
| 不完全列挙でremovedを断定しない、hash前消失の診断                   | `keeps traversal failures incomplete rather than reporting old paths as removed`, `reports a member disappearing after enumeration as unreadable, without removed inference` (inspect-group.test.ts)                                                                                    |
| symlink別名経由の新しいHTML入力も拒否                               | `rejects prospective glob outputs through a directory symlink alias` (application/report.test.ts)                                                                                                                                                                                       |
| hookの生成物隔離、stageされた実ファイル保持、外部参照制限と静的互換 | `globへ検査用distを混入させず、stageされたdistは保持する`, `stageされたnode_modules実ファイルを注入リンク扱いで削除しない`, `glob利用グループの絶対・外部参照をhookだけで拒否しindexと作業ツリーを保持する`, `既存の静的グループは外部固定参照の契約を維持する` (check-staged.test.mjs) |

同内容symlinkの検査中変更は `rejects a file symlink retargeted to another member during inspection even with identical bytes` (inspect-group.test.ts) で拒否を確認する。

全一致消失後の確認拒否は `refuses confirmation when the last match disappears even with two fixed files` (group-operations.test.ts)、特殊ファイルは `selects special files for explicit rejection without opening a FIFO` (glob-members.test.ts、POSIX)、literal CWD後の親移動は `allows parent paths after literal CWD metacharacters while retaining their literal meaning` (member-path.test.ts) で確認する。

基点0.4.0のCLIで生成した確認済み記録の互換性は `preserves a confirmed version 1 record produced by the 0.4.0 CLI byte for byte` (cli.test.ts) で確認する。

再照合で読取不能になった場合の旧hash露出防止は `does not expose an earlier hash as current when the final content recheck becomes unreadable` (inspect-group.test.ts) で確認する。

## 独立レビュー後の回帰条件

- native親aliasを通る未作成literal末尾や親階層、親移動の正規化後の新入力HTMLも、診断だけでなく書込み0で拒否する。`protects prospective report writes across native prefixes: $name` (application/report.test.ts)の相対/絶対、literal/wildcard、メタ文字、case違い、複数未作成親と正当な非一致の14条件で、実writerと入力/定義/記録不変を確認する。

- 環境由来のCWD先頭`!`はliteralとして保持し、生の利用者入力の除外構文と混同しない。`preserves a literal leading bang introduced by CWD rebasing: $cwd`、`keeps direct exclusion input rejected while preserving explicitly relative literal bangs` (member-path.test.ts)、`preserves leading bang CWD selectors through built CLI create, confirm, add and remove` (cli.test.ts)、`preserves a literal leading bang CWD with a parent management file in standalone SEA` (build-binary.test.ts)で確認する。
- File indexは範囲/メンバー列挙/定義が不明な場合に完全な0件と断定しない。正常な0件・取得済みパス・内容だけUnreadableは維持する。受入テストと実HTMLの条件は[HTML要件](html-report.md#不完全なfile-indexの受入条件)を正本とする。
- 定義の最終再確認に失敗した場合は、列挙が完了していても追加/削除の比較を未検証として扱い、確定した増減やNo baselineと混同しない。上記HTML要件の実ENOENT/EACCES統合テストと、`invalidates membership comparison when the final readable definition differs` (inspect-group.test.ts)で確認する。
- Windows絶対globのliteral prefixがOS aliasを含んでも実対象を選択する。既存`supports absolute patterns and parent paths without interpreting metacharacters in cwd`の2件期待を全OSで維持する。`matches existing native literal aliases without folding case or changing returned paths` (glob-members.test.ts)、`uses one physical identity for existing native path aliases` (content-hash.test.ts)、`protects prospective glob outputs through existing native directory aliases` (application/report.test.ts)でcase/dirlink/重複識別/未作成出力保護を確認する。aliasが存在しないFSの0一致と、存在するOS別表記を区別し、実Windows CIは別に確認する。
- staged symlinkはcheckout表現だけでなくindex mode120000/targetの意図を再現し、不能なら専用診断で拒否する。`core.symlinks=falseでもindexの外部file linkを専用診断で拒否し全入力を保持する`、`core.symlinks=falseでもindexの内部file linkを通常ファイル本文と混同せず検査する`、`core.symlinks=falseでもindexのdirectory linkへ降りず0一致を正しく診断する`、`core.symlinks=falseでもstatic-onlyの外部file link互換を維持する`、`core.symlinks=falseで再現不能なindex mode120000を同hashの通常ファイルとして通さない` (check-staged.test.mjs)で実Git/実hookとindex/worktree/設定不変を確認する。
