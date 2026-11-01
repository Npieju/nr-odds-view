# 取得経路調査・引継ぎ 2026-11-01

対象は中央競馬の通常単複。地方競馬・WIN5・海外競馬は実装対象外。

## 今回の確認

開始時のcheckoutはmain 3a1b4e35d4c11b31468ed8f68be0b5148c157552、変更なし。fetch後もorigin/mainとの差は0/0。
所有者が別WindowsアカウントのためGitが拒否した。グローバル設定は変えず、各コマンドの `-c safe.directory=<このリポジトリ>` で限定した。
Node v24.22.1あり。npmはPATHにないが依存なしなので `node --test` で検証可能。
従来の通信EACCESは今回再現せず。HTTP fetchでJRA競馬メニュー、そこに記載されたCNAMEによるPOSTが成功。
2026-11-01 21:01 JST頃、東京11Rの最終単複を取得、独立した公式レース結果から17馬番を照合。
生バイト、SQLite、出力JSONはgitignore対象data/内のみ。公開用fixtureには合成データだけ使用。

## 経路比較と判断

|経路|方式・券種|時間の意味と限界|契約・環境・公開|
|---|---|---|---|
|JRA Web|現行メニューのdoActionからCNAMEを発見、accessO.htmlへPOST、Shift_JIS。単複の最終数値レイアウトを実測|HTTP Dateは発表時刻ではない。今回の最終ページには発表時刻がなくnull保存。発売中の更新周期・最後に購入前に届く更新は未実測|ログインなし、閲覧料なし。自動取得頻度や再配信の許諾を確認できたとは扱わない。今回は少数回の品質調査|
|JRA-VAN Data Lab.|JV-LinkのJVRTOpen/JVRead。速報0B30/0B31〜36と時系列0B41/42を区別|10秒はサーバ更新ローテーションの刻み。当回レースでも開催条件で最大120秒との公式FAQ。時系列を後で取得しても当時の受信可能性の証明にならない|月額2,090円税込。Windows。現行SDK 5.0.0は32/64bit双方あり。未インストール・未契約・接続未検証|
|IPAT|ログインを伴う投票サービス。公開DLL例は公式データAPI契約ではない|公式の速報配信保証・時刻意味・他経路より速いという裏付けを今回得られていない|投票資格・認証が必要。認証情報未使用。今回採用せず|
|JRADB|エンドユーザーへ配信する商業利用の契約候補|個別の配信仕様・SLA・直前更新は契約資料確認が必要|料金は公開根拠未確認。JRA-VAN公式アナウンスが案内。Data Lab.個人料金で代用しない|

当面は公式Webをローカル品質測定用として選択。正規配信比較はData Lab.が候補だが、速さは未判定。
利用規約第7条は私的使用以外の利用・公開を制限する。無償サイトなら再配信可能とは解釈しない。
商用配信はJRADBの案内あり。非商用の派生ランキングについても許諾確認が必要。
データを含まないコードの公開と、オッズJSONの公開は別。公開Pagesに実データは置いていない。

## 一次根拠

- 現行SDK、インターフェース仕様・データ仕様へのリンク: https://developer.jra-van.jp/t/topic/45
- 更新周期の詳細: https://support.jra-van.jp/jravan/detail?category=16&id=227&site=SVKNEGBV
- JV-Data仕様、O1〜O6の発表月日時分は中間のみ設定: https://jra-van.jp/dlb/sdv/sdk/JV-Data4901.pdf
- JV-Link呼出し・返却値仕様: https://jra-van.jp/dlb/sdv/sdk/JV-Link4901.pdf
- 料金・Windows: https://jra-van.jp/dlb/
- 利用範囲: https://jra-van.jp/info/rule.html 第7条
- 商用配信案内: https://developer.jra-van.jp/t/topic/899
- 即PATの通常締切は各レース発走時刻1分前: https://www.jra.go.jp/dento/soku/instructions/pdf/guide_all.pdf?version=202409
- 事業所は2分前: https://www.jra.go.jp/kouza/baken/index.html

予定発走、変更後予定発走、実発走、販売経路ごとの締切、発表、受信、最終を同一時刻にしない。
締切はレース・経路・根拠とともにreplay queryへ与える。通常規則から一律自動生成していない。

## 既存調査・実装との照合

https://github.com/KeibaAI-developer/keiba-scraping/blob/develop/scraping/odds.py のJRA部分はPlaywright方式で単複テーブルを解析。ブラウザが必須とは限らず、今回HTTPだけで成功。コードの転載なし。
https://github.com/Mikimini9627/ipathelper_dll はI-PAT投票プログラムの例。公式速報オッズAPIの存在・低遅延の根拠にはしない。
https://note.com/sy_arch/n/nc5a3aa6b11db の利用者検証は観測遅延を検証すべき動機。記事の成果や数値を本環境へ転用しない。
https://github.com/miyamamoto/jrvltsql/blob/master/docs/timeseries_odds.md は公式時系列と速報蓄積を分ける公開設計例。保持期間や全賭式の過去復元可能性は現行公式仕様・実接続で確認してから採用する。

## 実装と使い方

`node src/cli.mjs collect-jra-final <現行CNAME> <manifest.json>`
manifestはrace_id、race_label（例: `2026年11月1日（日曜）4回東京11日 11レース`）、expected_selections（ゼロ埋め馬番）、roster_evidence（独立出馬表等のURL・raw_hash・受信時刻）を含む。
CNAME自体からレース同一性を推測せず、応答見出しとmanifestを照合。現段階ではmanifestのrace_idとrace_labelの対応は利用者が確認する。
最終・数値・馬番順単複のみ対応。未知のphase、取消、無投票、欠損、レイアウト変更は拒否しrawを残す。単複をトランザクションで保存。
取得試行と解析結果は別attempt行なので、HTTP試行数はstage=raw_onlyの行で集計する。

`node src/cli.mjs replay <query.json>`
query: source, race_id, market, decision_at, sales_close_at, channel, evidence, 任意maxAgeMs。
受信が判断時刻以下かつ締切より前のinterimだけから候補を選び、鮮度・受信欠損を表示。
最終との差は事後比較専用。最終値を購入前の価格に使わない。現機能は購入成立の保証ではない。
replayは単一候補選択と最終差の機能であり、全更新の時刻逆行や取消履歴を含む完全な売買バックテストではない。

## 次の実測

発売中の単複レスポンスを保存し発表時刻・取消・売止表示を確認してからinterimパーサーを追加する。
常駐場所はWindows PC等の独立プロセスを候補に、スリープ・時計同期・通信・再起動を管理する。Actionsの定期実行を秒単位コレクタにしない。
複数開催日の締切前後で受信ベースの遅延分布・欠損率・最終差を比較。ポーリング周期と元更新周期は別に測る。
権利確認、発売中収集の品質確認後にフロントとPagesへ進む。今回の最終取得だけでは直前収集は完成していない。
