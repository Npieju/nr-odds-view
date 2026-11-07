# ライブ配信の接続

公開画面: https://npieju.github.io/nr-odds-view/
読み取りAPI: https://nr-odds-live-feed.goodthinker.chatgpt.site/api/live

収集PC → ローカルdata/live.json → 認証付きPUT → SitesのD1 → 公開画面のGET。
公開画面は1秒ごと、送信プロセスは2秒ごとに変更を確認します。元データの更新・収集周期とは別です。
原文HTML・DB・認証情報は送信しません。公開物はフロント向けの観測・変動JSONです。

## 実行

1. `node src/cli.mjs prepare-jra <current-CNAME> data/race.local.json`
2. `node src/cli.mjs watch-jra data/race.local.json`
3. 別プロセスで `node --dns-result-order=ipv4first src/relay-cli.mjs` を起動し、非表示stdinへ `{"token":"更新用キー"}` を1行渡します。

更新用キーはSitesのPUBLISH_TOKENと一致させます。リポジトリやファイルへ保存せず、環境・セッションで管理してください。
現在の送信プロセスはこの開発セッションから起動しています。PCの停止・スリープ・プロセス終了時は配信も停止し、画面が古さを表示します。
自動ログイン・OS起動時の常駐・全レースの自動予約は未設定。これは常設のクラウド収集サービスではありません。

APIのGETは公開、PUTはキー必須。CORSはGitHub Pagesのoriginのみ許可。読み取りはno-store。
未来・60秒より古い生成時刻はPUTを拒否し、すでに保存した生成時刻より古いデータで上書きしません。
D1は最新1件だけ保持。元データと観測履歴はローカルSQLiteに残します。

## APIのソース

`feed-api/worker/index.js` と `feed-api/drizzle/` が配信APIのコードとマイグレーションです。
`feed-api/.openai/hosting.json` にSitesプロジェクトIDを保持。
サイトソースの正規リポジトリへpushした状態をパッケージしてSitesから公開します。GitHub PagesのworkflowはAPIをデプロイしません。
Windows付属GitのTLS接続で障害が出たため、初回はNodeの証明書検証付きHTTPSで同じGitスマートプロトコルへソースを転送しました。証明書検証は無効化していません。

## 現行対応

数値単複のみ。出馬表の馬番セルにブリンカーアイコンが含まれるケースを東京8Rの実応答で確認し、独立出馬表照合からその馬が落ちないよう修正しました。
不明な取消等の表示を推測で取り込むことはしません。

## 公開先での実測確認（2026-11-07）

東京8Rで13:44から収集。公開GitHub Pagesをブラウザで開き、レース名・10頭の実オッズ・発表／受信時刻・欠損警告が表示されることを確認。
13:45:40.356受信のスナップショット（発表13:44）がAPIから取得でき、累計9観測と実際の価格変動の集計を確認しました。
GitHub Pagesの公開workflowと30件のテストは成功。APIの認証なしPUTは401、GETは200、CORSとno-storeを確認。
当日の対象レースは東京8R、設定締切13:49。全レースの連続自動巡回は未実装です。
