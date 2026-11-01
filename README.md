# Odds Observer — 直前オッズの収集品質を測るバックエンド

最初の成果物は、可視化に使う値の鮮度・欠落・更新履歴を検証できる保存基盤です。
Node.js 24以上、追加npm依存なし。SQLiteと元レスポンスをローカルに保存します。

## 現在の実装状態

| 項目 | 状態 |
|---|---|
| 取得成功・失敗と応答時間の記録 | 実装済み |
| JRA公式へのCNAME指定POST、Shift_JISデコード、遷移リンク抽出 | 実装済み、現環境の外向き通信がEACCESのためライブ未検証 |
| 元レスポンスのバイト保存とSHA-256 | 実装済み |
| 共通形式による正規化データの取込 | 実装済み |
| 鮮度・欠落・最終値混入・取消・時刻逆行の検査 | 実装済み |
| 同内容が各経路で最初に観測された時刻の比較 | 実装済み |
| 検査済みデータから配信JSON生成 | 実装済み |
| JRA HTMLから券種別オッズ・発表時刻・レース同一性を抽出 | 未実装。実レスポンスを保存してから作る |
| IPAT認証・オッズ取得 / JV-Link接続 | 未実装 |
| 全開催の自動発見、常駐スケジューラ、公開API・画面 | 未実装 |

**本番コレクタの完成品ではありません。実測・再現・比較の土台です。**
合成例をライブデータに見せたり、取得時刻を発表時刻で代用する実装は入れていません。

## 公開構成

GitHub Pages: 画面のHTML/JS/CSSのみ。
独立した常駐プロセス: 公式サイト取得 → 元データ保存 → 正規化 → 検査 → SQLite。
公開JSON/API: SQLiteから生成し、独立したHTTP配信先へ配置。

直前データを更新するたびにPagesを再デプロイしないでください。Pagesの公開反映は即時ではなく、
Actionsのcronも最短5分・開始遅延があります。常駐収集とは分けます。
別ドメインのJSON配信では、画面のoriginを許可するCORSとCache-Controlの設定が必要です。
このパッケージはHTTP配信やGitHubへのpushをまだ行いません。

## 起動

```sh
npm test
# 現在の公式ページに実在するCNAMEを渡す。下のプレースホルダは置換する。
node src/cli.mjs probe-jra '<current-CNAME>'
node src/cli.mjs ingest normalized.json original-response.html
node src/cli.mjs compare
node src/cli.mjs export public/data/latest.json
```

`ODDS_DATA_DIR`で保存先を変更できます。既定は`data/`。
probe-jraは一回だけ取得します。継続収集や将来の予約実行は設定していません。
HTTP Date/ETag/Ageも記録しますが、オッズの発表時刻としては使いません。
エラー画面がHTTP 200で返る場合も一部検出します。それ以外のHTMLもraw_onlyのままで、
HTTP取得成功だけでオッズデータを有効と判定することはありません。

## 正規化データ契約（合成例）

```json
{
  "source": "jra-web",
  "race_id": "synthetic-race",
  "market": "win",
  "phase": "interim",
  "request_started_at": "2026-11-01T15:30:02+09:00",
  "received_at": "2026-11-01T15:30:03+09:00",
  "source_time": "2026-11-01T15:30:00+09:00",
  "time_precision": "minute",
  "expected_selections": ["01", "02"],
  "quotes": [
    {"selection": "01", "status": "active", "low": 2.0, "high": 2.0},
    {"selection": "02", "status": "active", "low": 4.0, "high": 4.0}
  ]
}
```

この例の2頭は架空です。単勝の馬番は01、馬連は01-02、三連単は01-02-03など、
アダプタでキーを統一します。馬連等は昇順、馬単等は順序を維持。
`expected_selections`は独立に確認した出馬表・発売対象から作り、受信した行をそのまま
全件とみなさないでください。レース日・場・回・日・Rと券種も応答から照合します。
本コアは各アダプタが正しいレース・時刻・状態を識別したことを前提とするため、
その対応が未検証のアダプタは本番に昇格させません。

時刻不明は`source_time:null, time_precision:"unknown"`とし、ランキング対象外にします。
`phase`はinterim/final/confirmedを明示。最終・確定を直前予測へ混ぜません。
取消・無投票・発売停止はそれぞれwithdrawn/no_votes/suspendedで、値はnullです。

## 品質の定義

- 元データは変更せず保持。応答ごとの観測を保存し、同じ値の再取得も捨てない。
- 時刻が分単位なら、古さを60秒の幅で表す。秒精度を捏造しない。
- HTTP応答時間とオッズの古さを分ける。発表時刻との差は、公開遅延・収集間隔等を含む。
- 同一レース・券種・phase・オッズ全体のハッシュが一致した場合だけ、経路間の初回観測を比較。
  観測差にはポーリングの位相が含まれ、真の配信遅延とは呼ばない。
  同じ価格が後に再登場することもあるため、compareは候補照合であって厳密な更新イベントの同定ではない。
- 更新時刻が同じなのに内容が変わった場合、改訂として保存し、時刻が進んだシグナルと区別。
- データが古い、時刻不明、比較間隔が長い、取消で母集団が変わった場合は変動ランキングを抑制。
- 別経路を黙ってつないで「急変」を作らない。経路ごとに系列を維持。
- 単純な倍率差に加えて対数変化を返す。複勝・ワイドの上下限は維持し、勝率と呼ばない。
- 画面側もgenerated_atとreceived_atから古さを判定する。古いJSONを「最新」と表示しない。

現在のexportは直前の異なる価格との変動を返します。固定60秒/180秒/5分窓、
各窓のデータ不足表示、単勝の支持率正規化、レース内パーセンタイルは次段階です。
オッズだけから絶対投票額や大口投票額を確定することはできません。

## 次に検証する順番

1. JRA公式の単複ページを実開催時に少数回収集。現行HTMLと時刻・phase・取消表示を確認。
2. その元HTMLを回帰用に固定し、単勝・複勝のアダプタを作成。
3. IPATまたはJV-Linkを比較経路として接続。同じレースを観測する。
4. 複数開催日の発走10分前〜締切後まで収集。実際の投票経路の締切を保存する。
5. 発走120/90/75秒前など、各判断時点で**その時刻までに受信済み**の最新値を再生。
6. 経路別に、発表時刻の古さの中央値/p95、欠落率、エラー率、最後に使えた更新、
   最終値との差、経路間で同じ更新が観測された時刻差を集計。
7. 品質を満たした経路・券種だけ公開。馬連、三連複、三連単へ拡張する。

最初から全券種を同頻度で取得すると、ページ巡回にかかる時間で鮮度が落ちます。
まず単複、次に対象券種を絞って、並列度・頻度は実測した更新頻度と応答時間から決めます。
締切後の価格変化は保存しますが、購入可能だったシグナルと区別して表示します。

## 調査根拠

- JRA直接取得の運用例: https://note.com/dijzpeb/n/n4dc467834532
- 後続の蓄積データ利用例: https://note.com/dijzpeb/n/n209802ccdb6b
- POST/CNAME/Shift_JISでHTTP取得する開発者報告: https://note.com/mytumultuouslife/n/ne55b694895bc
- JRA-VAN受信時刻の照合例（著者の経路での実測）: https://note.com/sy_arch/n/nc5a3aa6b11db
- JRA単複取得の公開実装を確認: https://github.com/KeibaAI-developer/keiba-scraping/blob/develop/scraping/odds.py
- IPAT取得ライブラリの公開仕様: https://github.com/Mikimini9627/ipathelper_dll
- 直前変化の研究: https://arxiv.org/html/2509.14645v3
- Pagesの公開反映: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- Actions scheduleの制約: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule

公開実装からコードはコピーしていません。実装・調査日: 2026-11-01。
取得した情報を公開する段階では、利用元の掲載・再配信条件を確認し、認証情報や生レスポンスを公開JSONに含めません。
