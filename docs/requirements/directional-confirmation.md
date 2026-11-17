# 方向付き確認の安全性と表示

## 要求

検出先だけの変更では未確認にしない一方、検査後に変わった検出先を古いsnapshotで受け入れてはならない。確認済みという表示で、検出先の現在内容まで再確認したと誤解させない。[Issue #28](https://github.com/tanaka-takuto/crosslink/issues/28)を根拠とする。

## 要件

- 確認状態と確認snapshotを分ける。状態は定義とsource集合/hashを比較し、snapshotは全unionの集合/hash/実効役割と管理定義raw/パスに結び付ける。静的方向付き定義でも検査中に全unionを再読する。
- target-onlyの検査後変更・集合変更も古いsnapshotとして拒否する。定義最終再検証不能、source/target検査中競合、一括確認の後続検査による先行変化は保存前に拒否しwrite0を保つ。検査は確認記録を更新しない。
- 新規は明示確認まで未確認とする。確認済みは方向付きでは「現在の検出元について未確認の影響がない」という意味で、target-onlyの現在内容のhash一致や人間による再確認を保証しない。従来の全bothでは全集合/hash一致を保つ。
- 詳細text/JSON/related/HTMLで、実効役割、変化したsource、確認先target、全unionの現在のパスと内容比較を区別する。ConfirmedとChanged targetの並存を正しく説明する。Removed履歴を現在所属やFile indexへ混ぜない。
- File index/relatedはsourceからtargetへの向きを示し、targetだけの編集がsourceの確認を要求するように表示しない。不完全探索・定義不能・読取不能を成功や比較元なしと混同しない。
- 旧v1/v2のcanonical定義、通常JSON、有効な確認を維持し、検査では書き換えない。役割明示時だけv3を使い、旧CLIは対応しない新形式として拒否する。未知フィールド、不正role、欠けた役割baselineは拒否する。
- HTMLは引き続きオフラインの読み取り専用snapshotであり、Not live、意味的保証ではない説明、keyboard・コピーfallback・出力衝突保護を保つ。

## 受入条件とテスト

| 条件                                                                 | 実テスト名と場所                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source比較とtarget差分の両立、source集合/roles baseline、旧canonical | `compares source content while retaining target content differences`, `compares source paths and ignores valid target-only membership changes`, `uses v3 only for explicit roles and includes roles in the canonical definition` (domain/directional-members.test.ts) |
| 不正role/未登録selector/壊れたbaselineの拒否                         | `rejects malformed or unbound selector roles %j`, `rejects v3 broken role baselines and v1/v2 role extensions` (domain/directional-members.test.ts)                                                                                                                   |
| 静的source/target競合と最終定義検証不能                              | `rejects static v3 $path content races (reverse=$reverse, baseline=$baseline)`, `never skips target read failures or definition final revalidation` (application/inspect-group.test.ts)                                                                               |
| stale一括確認write0、別グループ独立                                  | `rejects stale directional %s snapshot with zero writes to every selected group` (application/group-operations.test.ts)                                                                                                                                               |
| confirmed target差分、HTML役割/逆引きと英語説明                      | `explains confirmed target differences and directional reverse membership in generated HTML` (interfaces/cli/commands.test.ts)                                                                                                                                        |
| Node単独・stale target拒否                                           | `runs directional roles with Node alone, preserves source context and rejects stale target snapshots` (src/cli.test.ts)                                                                                                                                               |
| 実SEAの空PATH・role反転・source追加・target stale拒否                | `tracks directional source impact and rejects stale target snapshots with SEA alone` (script/build-binary.test.ts)                                                                                                                                                    |
| 実hookのtarget許可/source拒否・index/設定保持                        | `方向付きindexはtarget編集を許可しsource編集を拒否してindexと設定を保持する` (script/check-staged.test.mjs)                                                                                                                                                           |
| 簡潔出力維持と完全verbose                                            | `separates directional source context, review targets and target content comparison` (interfaces/cli/output.test.ts)                                                                                                                                                  |

既存のglob/alias/case/dirlink/管理記録とreport衝突、Node単独/SEA、staged symlinkの回帰条件は[動的集合](dynamic-membership.md)を引き続き適用する。実生成HTMLの視認性・操作と最終固定SHAの機能確認は別の独立レビューで判定する。

互換の具体条件は `keeps old both assignments and existing glob additions byte-identical without implicit role edits`、外部空roles v3は `preserves external empty-role v3 on no-op and explicit confirmation` (interfaces/cli/commands.test.ts) で確認する。targetだけのprospective出力は `protects prospective outputs selected only by target globs including parent aliases` (application/report.test.ts)、hook外部参照は `方向付きtargetの外部固定参照もglob混在hookで拒否し内容とindexを保持する` (script/check-staged.test.mjs) を対応テストとする。

3役割それぞれの内容・追加・削除・同内容rename後のstale拒否とwrite0は `binds all %s glob content and membership to confirmation snapshots`、一括確認の先行source/target競合は `revalidates an earlier directional %s before any batch write` (application/group-operations.test.ts) に対応する。
