# 任意のファイル間の関連付け

## 要求

意味上の関連性がある複数ファイルを、明示的なグループとして扱えること。
なぜ一緒に確認する必要があるのかを残せること。

## 要件

- 2ファイル以上を一つのグループとして登録できる。3ファイル以上も扱える。
- 編集途中では、構成ファイルが0件または1件のグループも保存できる。
- 検査で有効と扱うグループには、2ファイル以上が必要である。0件・1件のグループは、保存を拒否するのではなく、検査時に不正として失敗させる。
- 同じファイルを複数グループに登録できる。
- グループの追加・更新・削除は明示的に実行する。
- 確認記録の保存先として使用するファイルは、グループの関連対象に指定できない。個別指定の追加・更新時に拒否し、その理由を提示する。globを通じて一致した場合も検査を失敗させる。
- グループの登録には、名前と「確認が必要な理由」の両方を必須とする。
- 空欄の名前や理由で登録を完了させない。
- 名前でグループを識別し、確認対象を調べる際に理由を参照できる。
- ファイルを変更しただけでは、グループの確認が完了したことにしない。
- 個別removeとroleは解決した登録パスとの直接一致を優先し、指定外のselectorへ操作を広げない。直接一致しない別名指定は一意な場合だけ認め、曖昧なら登録パスの明示を英語で案内して保存せず拒否する。

## 受入条件

- A・B・Cを一つのグループにできる。
- A・BのグループとB・Cのグループを併存させられる。
- 名前または確認が必要な理由を欠いた場合、グループを登録できない。
- 確認記録の保存先を構成ファイルに含めた登録・更新は失敗し、確認記録ファイルは関連対象にできないことが分かる。
- CLIで保存・確認した管理ファイルは、拡張子の有無・大文字小文字・保存先ディレクトリにかかわらず、個別登録・個別追加・検査で関連対象として拒否される。
- A・BのグループからBを外してAだけにした状態を保存できるが、検査・CIでは不正な構成として失敗する。
- 全メンバーを外してもグループ自体を残して保存できるが、検査・CIでは不正な構成として失敗する。
- 0件・1件のグループにファイルを追加して2件以上にすると、ファイル数による不正は解消する。ただし、構成変更後の確認は別途必要である。

### 登録メンバー選択の受入条件とテスト

[Issue #34](https://github.com/tanaka-takuto/crosslink/issues/34)の修復操作を保護する。以下はすべて`src/interfaces/cli/commands.test.ts`に置く。

| 受入条件                                                                                                            | 実テスト名                                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| link→aとb/cの登録後link→bへ変わった場合、重複検査を拒否し、remove linkはb/cを残してcheck終了1。内容不変と旧確認失効 | `removes only the registered path after a symlink retarget and keeps the other members valid` |
| 直接一致しない曖昧aliasはremove/roleとも登録パスを案内して管理bytes不変                                             | `rejects an ambiguous native alias during %s without changing record bytes`                   |
| 複数指定で正常入力の後に曖昧・未登録があっても部分保存なし                                                          | `does not partially save $operation when valid selections precede an $error input`            |
| 一意aliasの相対・絶対指定、絶対登録の表記と既存互換                                                                 | `preserves unique native alias selection for $operation with $input input`                    |
| roleが指定外のselectorへ波及せず、実体の復旧が検証前に起きても指定だけを変更                                        | `limits role edits to registered %s when a retargeted symlink recovers before validation`     |
| 固定/glob混在の明示removeとroles清掃、0/1件draft                                                                    | `cleans only removed fixed and glob role overrides while preserving mixed selectors`          |
| 消失した登録パスを絶対入力でも登録解除できる                                                                        | `removes a missing registered path using an absolute input without resolving its contents`    |

実symlinkの試験は作成権限が必要で、未実施のOSの合格を意味しない。roleの重複選択検証では、選択後・保存前の実体復旧を制御し、通常の重複構成保存の拒否は維持する。

関連：[明示的な確認操作](explicit-confirmation.md)、[検査時の判定](check.md)、[要件一覧](../requirements.md)。

詳細仕様：[CLI仕様](../specifications/cli.md)、[保存形式](../specifications/storage.md)。

## globによる動的集合

個別指定に加え、[動的集合の要件](dynamic-membership.md)を適用する。globの追加・削除は現在の全パス集合として比較し、通常のglob削除は個別指定の消失とは区別する。選択・検査・確認・表示の受入条件と対応テストは同文書を正本とする。

明示した片方向の役割・失効条件は[検出元と確認先](directional-impact.md)、全union snapshotとConfirmed表示は[方向付き確認](directional-confirmation.md)に従う。既定の全bothの挙動は維持する。
