# 直前オッズ取得経路の調査と実測計画

確認日: 2026-11-01。対象: JRA中央競馬。地方競馬は比較調査のみ。
方針: **無料の公式Webを優先。JRA-VANは最後の手段**。契約・課金・試用開始は行っていない。

## 経路の比較

| 経路 | 取得方式・対象 | 時刻／締切直前の評価 | 費用・環境・保存／公開 |
|---|---|---|---|
| JRA公式Web（第一候補） | 現行ページのdoActionからCNAMEを取得しaccessO.htmlへform POST。Shift_JIS HTML。公式案内上WIN5以外。今回は単複のみ実装 | 実際のrefresh_lineの発表表示を保存。秒単位の元データ更新保証は確認できていない。高頻度に取りに行くことと価格が更新されることは別 | 閲覧のサブスク不要。Nodeで取得可能な実装。生データは私用保存のみ。継続自動取得の許容頻度・数値のWeb再配布条件は未確認 |
| IPAT（無料候補の追加調査） | 認証後の投票画面。非公式ライブラリにオッズ／締切／発売状態取得の実装例あり | 公式Webより速いとの保証は得ていない。表示締切を直接取得できる点は有用だが、実配信の同時計測が必要 | 投票会員・資格・認証が必要。認証情報は未取得、ログイン・購入・DLL導入なし。公開コードの存在は公式APIの許可を意味しない |
| JRA-VAN Data Lab.速報（任意、最後の手段） | 公式JV-Link COM、JVRTOpen→JVRead。0B31はO1単複枠、0B32〜36で他券種、0B30は全賭式 | 公式FAQの10秒は巡回枠。各レース一律10秒ではない。O1の発表時刻は分精度、最終／確定では未設定。締切までの到着保証なし | 月額2,090円税込、初回1か月試用案内あり。日本語Windows 10/11。通常契約は私用に限定、通常契約だけでWeb配信不可 |
| Data Lab.時系列（直前の第一候補にはしない） | 0B41単複枠／0B42馬連の履歴 | 公式説明で5〜10分刻み。速報の自前連続保存と区別する。後から取得しても当時受信できた証拠にならない | Data Lab.契約。原データの私用分析候補 |
| JRADB（公開サービス用の別契約） | 公式スタッフ案内の商業利用契約 | 今回は低遅延配信の仕様・更新間隔を確認していない。速さの解決策と断定しない | 法人のみ、料金は個別確認。個人向けData Lab.とは別。契約しない |
| 地方競馬公式 | NARの出馬表／券種別ページ | 公式FAQはアクセス時の値、最新表示には更新が必要と案内。配信周期や投票事業者ごとの締切は別途確認が必要 | JRAとはレースID・開催・投票経路が異なる。今回は実装対象外 |

### 一次情報

- JRAのオッズ掲載範囲・終了レースの最終オッズ: https://own.jra.jp/faq/pop02/1_1.html
- JRAサイト利用案内: https://jra.jp/use/ （この案内だけを根拠に、数値データの再配布が許されるとは判断しない）
- JRAの購入経路比較: https://own.jra.jp/dento/comparison.html
- JRA即PAT利用案内: https://jra.jp/dento/soku/instructions/pdf/guide_all.pdf?version=202501
- JRAダイレクト発売時間: https://www.jra.go.jp/dento/direct/instructions/hatsubai.html
- 施設の締切案内: https://www.jra.go.jp/kouza/baken/index.html
- JRA-VANの速報更新間隔FAQ: https://support.jra-van.jp/jravan/detail?category=16&id=227&site=SVKNEGBV
- キャッシュと巡回頻度の公式FAQ: https://support.jra-van.jp/jravan/detail?category=16&id=207&site=SVKNEGBV
- データ概要（履歴と速報の区別）: https://jra-van.jp/dlb/ddata.html
- SDKと対応バージョン: https://developer.jra-van.jp/t/topic/45
- JV-Data仕様書4.9.0.1: https://jra-van.jp/dlb/sdv/sdk/JV-Data4901.pdf
- JV-Link仕様書4.9.0.1: https://jra-van.jp/dlb/sdv/sdk/JV-Link4901.pdf
- 料金／試用: https://jra-van.jp/dlb/dlrt_web_x64.html
- 利用規約7条: https://jra-van.jp/info/rule.html
- 再配布・JRADB法人条件: https://developer.jra-van.jp/t/topic/899
- NAR公式FAQ: https://www.keiba.go.jp/qa.html

## 読み違いを防ぐための確認

1. JRA-VAN公式FAQの例には当回レース110秒、終盤70秒、日曜最終の条件で10秒等がある。キャッシュ有効時間も負荷で調整される。公称最短値を常時の鮮度として使わない。
2. O1は中間／前日売最終／最終／確定を区別する。発表月日時分は中間のみ設定。作成年月日と発表時刻は別物。
3. 発走予定時刻、実際の発走、購入経路の締切は別。即PAT等の通常馬券は案内上1分前、施設2分前。JRAダイレクトについて古い記事の5分前と現行公式比較表の2分前に差があるため、経路と確認日を固定する。WIN5・海外・地方を同じ規則で処理しない。
4. JRA公式Webで今回確認したのは最終表示。結果リンクがあるからといって、Webの「最終」をJVの「確定」に読み替えない。
5. 30秒pollは30秒更新の証拠ではない。取得応答が速くても、同じ古いオッズなら鮮度は上がらない。

## 既存調査・公開実装を追った結果

- https://note.com/dijzpeb/n/n4dc467834532 と https://note.com/dijzpeb/n/n209802ccdb6b : 公式Web巡回による全券種保存の公開報告。無料で読める範囲を確認。1分pollや「5〜1分前」の報告は、元データがその間隔で更新されたことの証明ではない。有料本文・添付コードは購入していない。
- https://note.com/mytumultuouslife/n/ne55b694895bc : 開発者自身がCNAME POST、コードページ932、odds_tan／odds_fuku、券種リンク連鎖を記述。ブラウザー操作なしの取得が現実的な候補。1秒pollの記述を許容頻度や推奨値として採用しない。
- https://github.com/KeibaAI-developer/keiba-scraping/blob/develop/scraping/odds.py : GitHub連携でコードを確認。公式トップ→オッズ→開催→レースのPlaywright遷移、単複表の読み取りを実装。ただし本プロジェクトに必要な発表時刻・phase・締切の保証はこの関数からは得られない。コードはコピーしていない。
- https://zenn.dev/tkmn/scraps/cc57d75599f0af : 開発者の通信解析にform POSTとURLエンコードの例。古いCNAMEは実行に流用せず、現行リンクから取得する。
- https://github.com/kawaberi01/jra-scr/blob/main/docs/jra/05_API%E4%BB%95%E6%A7%98.md : 公開プロジェクト独自APIとas_of参照の例。文書名の「JRA公式API」はJRAが公開した外部APIの存在を裏付けない。
- https://note.com/sy_arch/n/nc5a3aa6b11db : 運用者の内容照合による到着遅延検証。60秒poll、同じ価格の照合という測定限界がある。そこで報告された平均62秒を全経路のSLAや公式Webの遅延として扱わない。
- https://developer.jra-van.jp/t/topic/489 : 10秒ごとに値が変わらないという利用者の報告。スタッフの具体例照会までを確認。原因が公式に確定された報告ではない。
- https://github.com/miyamamoto/jrvltsql : 速報保存と公式履歴を区別する実装例。JV-Link依存のため無料公式Web取得の代替ではない。
- https://github.com/Mikimini9627/ipathelper_dll : 作者のAPIにGetRaceCardと締切／発売状態取得がある。投票処理を含むため導入せず、取得専用経路を検証する場合の参考に留める。

公開実装の機能説明は各作者の主張であり、JRAが許諾した運用・更新保証とは区別する。

## 今回実際に確認した公式HTML

2026-11-01に接続済みChromeで公式トップの「オッズ」→重賞レースへ通常遷移した。
ページは単勝・複勝（馬番順）、最終オッズ表示。
取得したのはDOMの構造情報で、HTTP原レスポンスの保存／発走前の観測ではない。

- race_header内のdate、発走時刻、race_number画像altでレースを照合できる。
- refresh_lineのtimeにstrongの最終表示があり、この最終ページに発表時刻はない。
- table.basic.narrow-xy.tanpuku、td.num、td.odds_tan、td.odds_fuku。
- 複勝はspan.min／span.max。枠欄にrowspanがあるため、列番号決め打ちはしない。
- 単複リンクのdoActionに現行CNAMEがある。CNAMEを日時から推測・生成しない。

この形状を基に独立実装した。テストの馬・価格・レース識別は合成で、実データはコミットしない。
中間表示、前日売り、取消、無投票、上限表示は実レスポンスによる受入検証が残る。
未知表現を無理に数値化せず、raw保存＋失敗に倒す。

## 通信制限の切り分けと実行場所

- 現在の実行プロファイルはnetwork restricted。Node fetchからJRAはEACCES、gitからGitHubは接続失敗。
- GitHub MCPは利用可能で、mainのSHA照合は成功。JRA用HTTP POSTコネクターは見つからない。
- 接続済みブラウザーで公式ページへ到達。したがって「JRA全体がアクセス拒否」ではなく、少なくともこの実行経路に制約がある。
- このセッションではsandbox承認が無効で、権限拡張による解消はできない。セキュリティ設定は変更していない。
- 次の実取得は、JRAへHTTPS接続できる通常のPC端末で本リポジトリを実行するか、ネットワークを許可した開発実行環境を用意する。必要通信先はwww.jra.go.jp:443。最初にdiscover-jraの成功を確認し、rawとattemptsを残す。
- JV-LinkはCOM REGDB_E_CLASSNOTREG。加えて既定Windows PowerShellの-File実行はポリシーで拒否された。無料経路には不要なので、導入やポリシー変更を要求しない。

## 次に必要な実測と判定

無料経路でまず1レースを発走10分前から最終表示まで取得する。自動探索を拡大する前に、同時リクエストは1本、初期30秒poll、連続失敗時はバックオフする。
実際の元データの更新、レスポンス時間、サイト側案内を見て頻度を決める。更新がないのに頻度だけ上げない。

| 測定項目 | 記録／判定 |
|---|---|
| 発表時刻→受信時刻 | 分精度の幅で中央値／p95。通信所要時間と分ける |
| 価格更新／時刻更新 | 同内容の再取得も保存。更新イベントは時刻と内容両方を確認 |
| 停止・欠損 | 試行失敗数、受信間隔、元時刻逆行、未知表示、欠落馬番 |
| 締切に間に合ったか | 購入経路の締切前に受信完了した最後のinterim。締切後受信の過去時刻データを除く |
| 最後の値の鮮度 | 最後の受信時刻だけでなく、元データの古さを締切時点で判定 |
| 最終との差 | final／confirmedを別保存し事後比較。購入前情報に混ぜない |
| 公開判断 | 十分な開催で品質検証し、原データ・派生値の公開条件を確認した範囲だけ |

IPATを比較する場合も注文・入出金を実装せず、取得専用で同一レースを照合する。
無料経路で目的を満たせないことが実測で判明した後にのみ、有料経路を再検討する。
フロントの静的配信はPages等、収集はPC／サーバーの永続ディスクへ分離する。
GitHub Actionsはテストに使い、秒単位収集のタイマーには使わない。

Actions scheduleの公式制約: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
