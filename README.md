# Odds Observer — 直前オッズの取得品質を測るバックエンド

**無料のJRA公式Webを第一候補とする。JRA-VANは最後の手段・任意の比較用。**
Node.js 24、外部npm依存なし、組み込みSQLite。フロント／Pagesは取得品質と公開条件の確認後。

## 引き継ぎと現在の状態（2026-11-01）
- 旧作業ツリーはクリーン、mainは `3a1b4e35d4c11b31468ed8f68be0b5148c157552`。GitHub APIのmainも一致。
- 旧ディレクトリを変更せず、新しい会話の `odds-observer/` に複製して作業。
- 無料Web: CNAME指定POST、生バイト保存、Shift_JIS解析、単勝・複勝の正規化、SQLite蓄積を実装。
- 公式の現行DOMでtanpuku表・馬番・レース識別・最終表示を確認。中間表示の実レスポンスは未採取。
- **ライブHTTP取得は未検証**。この環境のNode fetchはJRAに対して `EACCES`。ブラウザーでは公式ページへ到達できた。
- JV-Link接続とO1解析は補助実装。COM未登録、実配信未検証。契約・インストール・試用開始は行っていない。
- 合成データのテストは `node --test` で実行。実配信成功とは区別する。

調査・取得経路比較・制約・次の実測は [docs/data-sources.md](docs/data-sources.md)。

## 無料経路の実行

```powershell
node --test
node src/cli.mjs discover-jra
node src/cli.mjs probe-jra '<現行公式リンクのCNAME>'
node src/cli.mjs collect-jra race.local.json
# 重複起動しない。30秒間隔、30回で終了。失敗時バックオフ、連続3失敗で停止。
node src/cli.mjs watch-jra race.local.json 30000 30
node src/cli.mjs compare
node src/cli.mjs audit audit.local.json
node src/cli.mjs export
```

`ODDS_DATA_DIR` は既定で `data/`。生データ・DB・出力はgit対象外。
exportはこの保存先の配下のみ許可し、既定出力は `data/exports/latest.json`。
データの再配布許可を確認するまでは公開ディレクトリに配置しない。
公開リポジトリにはコード、説明、合成テストだけを置く。

`race.local.json` は実際の公式ページと独立に確認した出馬表から作成する。以下は**架空の例**であり、実行用データではない。

```json
{
  "race_id": "2026110105041111",
  "cname": "synthetic/AB",
  "expected_selections": ["01", "02"],
  "roster_evidence": "確認した公式出馬表の参照と取得日時",
  "timing": {
    "scheduled_start_at": "2026-11-01T15:40:00+09:00",
    "sales_close_at": "2026-11-01T15:39:00+09:00",
    "sales_channel": "ipat",
    "evidence": "実際に確認した締切表示・公式案内の参照",
    "observed_at": "2026-11-01T15:00:00+09:00"
  }
}
```

race_idはJV形式の年月日・場・回・日・Rの16桁。netkeibaの12桁IDと混ぜない。
CNAMEの末尾やチェック値は生成せず、現行の公式リンクから取得する。
discover-jraはトップのリンクを取得し、probe-jraで遷移先のリンクを調べられる。全開催の自動探索はまだない。
`timing` は省略可能だが、締切不明のデータはシグナル対象外。
発走時刻変更があれば設定を更新し、確認時刻と根拠を残す。発走時刻から締切を自動推定しない。
watchは設定を毎回読み直す。初期30秒間隔は測定の仮設定で、配信の更新間隔を意味しない。

## 時刻と品質
- リクエスト開始、受信完了、元の発表時刻、表示発走予定、購入経路別締切を分けて保存。
- 分精度の発表時刻は古さを幅で示す。HTTP Date/Age/ETagは発表時刻に使わない。
- 最終／確定は別phase。公式Webの「最終オッズ」を「確定」に読み替えない。
- 不明な表示、別レース、欠損・重複馬番、未知の値、未来の発表時刻は取り込まない。生バイトと失敗を保持。
- 発表時刻の逆行、同一時刻の改訂、古い値、収集停止、構成変更、上限表示を検知／抑制。
- 当初は単複だけ。枠連以下の組合せ券種は未実装。
- export schema v2 は `access:private`。締切後と締切不明のデータはランキング対象外。
- APIのexport(now)は、その時刻までに受信した行だけを使用する。
- オッズの変化を資金流入額や利益の保証と解釈しない。

## 締切後の監査

`audit.local.json` の例（架空）:

```json
{
  "source": "jra-web",
  "race_id": "2026110105041111",
  "market": "win",
  "cutoff": "2026-11-01T15:39:00+09:00",
  "deadline_evidence": "確認した購入経路の締切表示の参照",
  "deadline_observed_at": "2026-11-01T15:00:00+09:00",
  "as_of": "2026-11-01T16:00:00+09:00"
}
```

締切より厳密に前に受信した最後のinterimを採用し、締切以降に届いた過去時刻のデータは除外。
最後の観測と、その鮮度が許容範囲だったかを分けて返す。最終／確定との差は事後検証専用。
購入処理の完了可能性は証明しない。監査の締切根拠自体も締切前に判明している必要がある。
中央値／p95は観測した発表時刻からの古さの上限、リクエスト所要時間、取得間隔、失敗数を出力。
公表遅延とネットワーク遅延を分離した実測ではない。
compareは同じ内容を各経路で最初に観測した差で、同じ価格の再登場もあり、同一更新の証明ではない。

## 任意のJV-Link
利用する場合だけ `node src/cli.mjs collect-jvlink race.local.json`。
CNAMEは不要。Windows日本語版と公式JV-Link、利用条件の確認が必要。
`JVLINK_POWERSHELL` で導入済みJV-Linkとビット数が合うPowerShellのパスを指定できる。
通常の収集にJRA-VAN契約は要求しない。

## 配信構成
収集はPC／独立サーバーの単一常駐プロセス、SQLiteとrawを永続ディスクへ保存。
フロントの静的配信先と、鮮度を要するJSON配信先を分離する。
Actionsはテスト向け。cronの起動遅延があるため秒単位収集の基盤にしない。
現段階ではPages公開・外部配信・契約は行っていない。
