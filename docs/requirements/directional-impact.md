# 検出元と確認先の役割

## 要求

ADRの追加・変更から実装への影響を確認し、実装だけの変更では過去のADRを確認対象にしない関連を扱いたい。逆向きの用途や既定の双方向も同じグループモデルで表す。[Issue #28](https://github.com/tanaka-takuto/crosslink/issues/28)を根拠とする。

## 要件

- 個別ファイルとglobの選択に、両方（既定、both）、検出元のみ（source-only）、検出先のみ（target-only）を明示する。通常の既存操作と旧定義は全て両方のままとする。
- 全検出元から全検出先への関係をグループ内で表す。検出元のみは変更の文脈、検出先（両方を含む）は影響を確認する対象とする。個別の辺は複数グループで表し、グループ間伝搬や推移閉包は行わない。
- 検出元の現在のパス集合と内容ハッシュを最後の確認と比較する。内容変更・追加・削除・同内容renameで未確認になる。完全に復元すれば確認済みに戻る。
- 検出先のみの内容変更とglob集合の通常の増減は失効理由にしない。別グループで同じファイルが検出元なら、そのグループは独立して失効する。
- 選択が同じ解決パスに重なるときはunion一件とし、sourceとtargetの双方に一致すれば実効bothとする。同じ役割のglob同士、globと個別選択も重複計上しない。個別選択同士の重複と別名で同じrealpathへの参照は禁止し、hardlinkの従来の扱いは変えない。
- 役割の変更・解除・方向反転は非対話CLIで明示的に行う。選択・役割を編集した定義へ旧確認を引き継がない。
- 検出先にも消失・読取不能・管理ファイル選択・strict探索不能・各glob0一致の検査を適用する。全unionが二実ファイル以上、実効sourceとtargetが各一件以上を有効条件とする。不完全なdraftは編集保存できるが検査・確認を拒否する。

## 受入条件とテスト

| 条件                                                                             | 実テスト名と場所                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 初回未確認、source変更/復元とtarget変更でConfirmed、source context/targetsの区別 | `keeps target-only changes confirmed and exposes source changes and review targets (glob=%s)` (application/inspect-group.test.ts)                                                                                                                                      |
| source/target globの追加・削除・同内容rename、0一致                              | `compares %s glob additions, removals and same-content rename` (application/inspect-group.test.ts)                                                                                                                                                                     |
| 旧双方向のどちらからの変更と復元                                                 | `records explicit confirmation, detects either direction and restores identical content` (application/group-operations.test.ts)                                                                                                                                        |
| 重なりで実効both、alias禁止、source集合の役割変化                                | `merges selector overlaps into one effective both without permitting physical aliases`, `rejects fixed lexical aliases even across source and target roles`, `tracks source-role changes caused by overlapping dynamic membership` (application/inspect-group.test.ts) |
| 片側だけのdraftは保存可・検査拒否                                                | `allows saving a %s draft but rejects missing effective side` (application/inspect-group.test.ts)                                                                                                                                                                      |
| 方向反転/解除、個別/glob編集、旧形式維持                                         | `creates directional selectors, edits roles explicitly and preserves the ordinary v1/v2 format` (interfaces/cli/commands.test.ts)                                                                                                                                      |
| グループ独立、source/target双方のstale拒否とwrite0                               | `rejects stale directional %s snapshot with zero writes to every selected group` (application/group-operations.test.ts)                                                                                                                                                |

受入条件の対応はテストの成功を意味的整合性の保証として扱わない。保存・snapshotと表示は[方向付き確認](directional-confirmation.md)、操作は[CLI仕様](../specifications/cli.md)を参照する。

直接所属と方向・推移伝搬なし、roleを戻しても確認を復活させない条件は `keeps directional groups independent and target reverse lookup distinct from propagation` (interfaces/cli/commands.test.ts) に対応する。
