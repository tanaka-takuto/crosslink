# 管理ファイルの保存形式

一つのグループを一つのJSONファイルに保存する。既定の配置は `.crosslink/{name}.json`。
グループ定義と最後の確認記録を同じファイルに保存し、独自の確認履歴は蓄積しない。

## グループ定義

```json
{
  "kind": "crosslink-group",
  "version": 1,
  "name": "api",
  "reason": "API仕様と実装を一緒に確認するため",
  "files": ["../docs/api.md", "../src/api.ts"]
}
```

| 項目         | 内容                                                              |
| ------------ | ----------------------------------------------------------------- |
| kind         | 管理ファイルであることの明示的な宣言。新規保存ではcrosslink-group |
| version      | 形式のバージョン。役割明示は3、それ以外は静的1・glob2             |
| name         | 空欄でないグループ名                                              |
| reason       | 空欄でない、確認が必要な理由                                      |
| files        | 登録パスの配列。0・1件でも保存できるが、検査では不正              |
| globs        | version2/3の選択パターン配列。展開結果ではなく文字列を保持        |
| confirmation | 最後の確認記録。未確認の新規グループでは省略                      |

相対パスは管理ファイルのディレクトリから解決する。拡張子や内容形式による対象のホワイトリストは設けない。
読み取れる通常のファイルを対象とし、ファイルのシンボリックリンクは参照先の内容を読む。
ディレクトリや特殊ファイルを構成ファイルとして登録しない。個別指定同士の同じパス・同じrealpathを指す別パス重複は不正とする。globと個別指定の同じ解決済みパスは一つにする。
管理ファイル参照とnative aliasの実体比較では、Node標準FSの`bigint: true`でdev/inoの整数精度を保持する。ハッシュ読取中の再検証も同じ精度のID/sizeとmtimeNs/ctimeNsを比較し、BigIntのms値へ切り捨ててサブmsの変化を見落とさない。メンバーの公開identityは従来のnative realpathとし、通常のhardlinkの別パスを新たな重複禁止にはしない。
根拠：[Node24.22.2 Statsとns時刻](https://nodejs.org/download/release/v24.22.2/docs/api/fs.html#class-fsstats)、[Issue #32](https://github.com/tanaka-takuto/crosslink/issues/32)。
管理JSON自身や、設定した管理ディレクトリ内の管理JSONは関連対象にできない。
ディレクトリ外でも、トップレベルに `kind: "crosslink-group"` を宣言したファイルは、拡張子にかかわらず関連対象にできない。
名前・理由・パス配列が似ているだけの通常JSONは、この宣言がなければ管理ファイルと推測しない。
管理ファイル自体のシンボリックリンクは使用できない。

## 旧形式の移行

kindのない旧形式も、管理ディレクトリ内または明示指定された管理ファイルとして読み込める。
検査だけではkindを追加しない。`migrate 管理ファイル`、または明示的な編集・確認操作による保存で宣言を追加する。
移行だけを行う場合は既存の確認記録を保持し、変更後の内容を自動的に確認済みにはしない。

管理ディレクトリ外の旧形式は、通常JSONと同じ構造であり、内容から役割を自動的に区別できない。
そのような既存の管理ファイルは `migrate` で役割を明示してから利用する。

## 確認記録

`confirmation` は次の項目を持つ。

| 項目       | 内容                                                                |
| ---------- | ------------------------------------------------------------------- |
| definition | 名前・理由・個別パス集合・glob集合を安定順序で表現したJSONのSHA-256 |
| hashes     | 確認時の全実メンバーパスをキー、内容のSHA-256を値とするオブジェクト |

ファイル内容はバイト列のまま比較する。改行や文字コードの変換は行わない。
グループ編集で定義が変わった場合は確認記録を外し、未確認に戻す。
ファイル内容と実パス集合を最後に確認した組み合わせへ戻した場合は、保存された記録との一致により確認済みに戻る。
形式の未知の項目、未対応バージョン、不正なハッシュ、JSONの破損はエラーとする。

## 設定

実行ディレクトリの `crosslink.config.json` を任意で置ける。`--config` による明示指定もできる。
親ディレクトリをプロジェクトルートとして探す処理は行わない。

| 項目             | 既定値      | 意味                                                   |
| ---------------- | ----------- | ------------------------------------------------------ |
| directoryName    | .crosslink  | 探索する管理ディレクトリ名。単一の名前                 |
| fileNameTemplate | {name}.json | 新規作成するファイル名。{name}を一つ含むJSONファイル名 |

ディレクトリ名・生成するファイル名には、Windowsでもファイル名として使用できる名前を指定する。
設定の変更で既存ファイルを自動改名・移動しない。ファイル名テンプレートは新規作成時に適用し、探索では管理ディレクトリ内の全JSONを読む。
グループ名が同じでも管理ファイルのパスで区別する。操作対象は管理ファイルのパスで明示する。

関連：[永続化の要件](../requirements/persistence.md)、[グループの要件](../requirements/groups.md)、[確認状態](../requirements/confirmation-state.md)。

## globを含むversion2

```json
{
  "kind": "crosslink-group",
  "version": 2,
  "name": "adr",
  "reason": "正本とADRを一緒に確認するため",
  "files": ["../docs/design.md"],
  "globs": ["../docs/adr/**/*.md"]
}
```

version1は引き続き読み取り、有効な既存確認を保持する。静的グループを検査や一律移行でversion2にしない。
version1にglobsがある定義は不正。役割明示がない場合、globsが空またはないグループは保存時version1、空でない場合はversion2とする。
旧静的canonical JSONは変更せず、globsがある場合だけ整列・重複除去したglobsキーを追加する。kind/version自体はdefinitionの入力に含めない。
filesはメタ文字を含めリテラルのまま、globsは[選択構文](glob-selection.md)に従う。選択パターンを保存し、一致ファイル一覧へ書き換えない。
v1/v2の確認時には実パス集合とhashesのキー集合が完全一致する必要がある。現在のパスのハッシュだけが一致しても、削除された旧キーがあれば未確認とする。

## 方向を明示するversion3

```json
{
  "kind": "crosslink-group",
  "version": 3,
  "name": "adr-impact",
  "reason": "ADR変更の実装への影響を確認するため",
  "files": ["../src/api.ts"],
  "globs": ["../docs/adr/**/*.md"],
  "roles": {
    "files": { "../src/api.ts": "target-only" },
    "globs": { "../docs/adr/**/*.md": "source-only" }
  }
}
```

rolesはfiles/globsの二つのオブジェクトを必須とする。キーは対応する登録selectorと完全一致させ、値はsource-onlyまたはtarget-onlyとする。省略したselectorはbothとする。bothはoverrideを削除して表現する。未知フィールド・未登録selector・不正値・配列やnullは拒否する。外部の空roles v3も読み込み、検査/no-opで書き換えず、明示confirmではv3と実効both baselineを維持する。新規allbothは旧形式で保存し、実編集で最後のoverrideを解除したらbaselineを外して静的v1/glob v2へ戻す。

v1/v2へrolesは追加できない。source-only/target-onlyを明示しない通常作成・検査・既存の編集/確認で一律v3にしない。既存bothへのboth再指定は管理bytesと確認記録をそのまま保つ。旧v1/v2のcanonical定義と有効な確認記録、JSON出力はそのまま保つ。v3ではcanonical定義末尾にrolesを追加し、files/globsの各mapをキーで安定整列する。保存済みの役割変更・解除・反転は定義変更となり確認記録を外す。役割ごとの配列に分割する案と比較し、既存のselector・表示・hookと共通のunionを維持できるmapを採用する。

v3のconfirmationには全unionのhashesに加え`roles: { "実メンバーパス": "both | source-only | target-only" }`を保存する。rolesのキー集合はhashesと完全一致し、有効な実効役割だけを許す。削除済みsourceとtargetを区別するため、現在の定義から再推測しない。

確認状態は定義とsourceを含む現在パス集合・hashのみをbaselineと比較する。target-onlyの内容・集合だけが違っても、構成と参照が有効なら確認済みとなる。全union二件以上、実効sourceとtarget各一件以上が必要である。同じ解決パスは役割を合成し、source+targetはbothとなる。個別選択の重複は不正、glob同士/個別とglobの重なりはdedup、別名の同じrealpathは禁止する。

snapshotは状態の失効条件より厳しく、管理パス・raw・全union path/hash/roleを結合する。target-onlyの検査後変化でも確認を拒否する。v1/v2の既存snapshot式は変更しない。v3非対応の0.5.0以前のCLIは新形式を拒否し、役割を無視して双方向として検査・確認しない。旧CLIと共有する定義へ手でversionを下げない。
