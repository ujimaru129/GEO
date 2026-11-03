# エンタメGEO

生成AI（ChatGPT系 / Gemini / Perplexity / Claude）の回答を「正確性・鮮度・推薦」の3軸で計測するシステム（MVP開発中）。

## 現在の状態: フェーズA（計測エンジン）

| 機能 | 場所 |
| --- | --- |
| DBスキーマ（Supabase/Postgres） | `db/migrations/0001_init.sql` |
| 質問辞書（業界別YAML）と計測対象 | `questions/*.yaml`, `data/entities.yaml` |
| 4エンジンの共通クライアント（モデル名・単価は設定で差し替え） | `src/engines/`, `config/engines.yaml` |
| 並列実行・リトライ（最大3回）・費用記録・月間予算上限 | `src/runner/`, `config/measurement.yaml` |
| 顧客プラン（頻度・試行回数・質問セット・原価上限） | `config/plans.yaml`, `src/plans.ts` |
| 正解データ（facts）の CSV 取り込み | `config/fact_keys.yaml`, `src/facts.ts`, `data/facts.template.csv` |
| 画面のための仕組み（専用URL・社内メンバー・記入依頼と承認・確認履歴） | `db/migrations/0002_app.sql`, `src/app/` |

## 画面と仕組み（2026-11-03 確定）

設計ページ: https://claude.ai/artifact/U7sajCRw1nh9qsZxhXWzi2

| 決定事項 | 実装 |
| --- | --- |
| 顧客は専用URL（＋月次PDF）でレポートを見る。ログインなし | `report_links`（トークンはハッシュのみ保存、顧客ごとに有効なURLは1つ）、`src/app/report-links.ts` |
| 運営コンソールは社内チームの複数人が使う | `staff_members`（Supabase のメールログイン＋許可リスト）。確認・承認は誰がいつかを記録 |
| 「誤り」判定と Lite の助言は社内が確認してから公開 | `claim_reviews`、`report_advice` |
| Lite のレポートにも改善の助言を含める | `report_advice`（生成はフェーズD） |
| 正解データは社内・顧客の両方から入力 | 社内: CSV / フォーム（`prepareStaffFact`）。顧客: 記入依頼 → 記入 → 社内承認（`fact_requests`, `fact_submissions`, `src/app/fact-requests.ts`） |

- 顧客の記入で出典URLがないものは「顧客の申告」（`source_type = client_provided`）として記録する
- 未発表の情報は公表日（`public_from`）を入れ、それより前の AI の回答の判定には使わない
- 承認時に「古い値を終了して承認」を選ぶと、現在の値の valid_to を自動で閉じる（卒業・移籍）
- 顧客も分からない項目は `unknown` で閉じ、判定は「照合不能」のまま

## 顧客プラン

`config/plans.yaml` で定義し、`data/entities.yaml` の `clients[].plan` で顧客に割り当てる。

| | Lite | Basic | Pro |
| --- | --- | --- | --- |
| 契約 | 単発（お試し） | 月額サブスク | 月額サブスク＋人によるサポート |
| 全質問の計測 | 1回（受注時に手動実行） | 週1回（月曜） | 週1回（月曜） |
| 重要質問の追加計測 | なし | 週2回（月・木） | 週2回（月・木） |
| 試行回数 | 3 | 3 | 5 |
| 質問 | `plans: [lite]` の質問のみ・言い換えなし（1業界約11〜12問） | 全質問 | 全質問 |
| 販売価格 | 未定 | ¥40,000/月 | ¥80,000/月 |
| 原価上限（1社/月） | ¥3,000 | ¥20,000 | ¥40,000 |

- 価格はプランごとの固定料金。`runs.cost_allocation` の按分は社内の原価把握用で、請求には使わない
- Lite は `npm run measure -- --scope full --clients <顧客ID>` で実行する（定期実行には含まれない）
- 【要検討】Lite の計測内容・正解データの範囲と入力者
- 発見カテゴリの質問は同じ業界の顧客で共有し、費用は `runs.cost_allocation` に按分して記録する（`client_monthly_cost` ビューで顧客別に集計）
- 共有の質問で、プランの試行回数を超えた回（例: Basic 5回・Lite 3回の4〜5回目）は、必要な顧客だけが負担する
- 顧客の原価上限に達したら、その顧客の分だけ止める（共有の質問は残りの顧客で負担）

## 正解データの登録

1. `data/facts.template.csv` を Google スプレッドシートなどで開き、1行＝1つの事実で入力する
2. CSV で書き出し、`npm run facts:import -- <ファイル> --dry-run` で検証 → 問題なければ `--dry-run` を外して登録

| 列 | 内容 |
| --- | --- |
| entity_id | `data/entities.yaml` の対象ID |
| key | `config/fact_keys.yaml` の項目（業界ごと） |
| value | 一覧は `A\|B\|C`、日付は `YYYY-MM-DD`、リリースは `作品名\|YYYY-MM-DD` |
| valid_from / valid_to | 現実世界で有効だった期間（両端を含む）。現在も有効なら valid_to は空 |
| source_url / checked_at | 出典URL（必須）と確認日 |
| public_from | 公表日（任意）。未発表の情報は、この日より前の AI の回答の判定に使わない |
| note | 任意のメモ |

- エラーが1件でもあれば何も登録しない（行番号付きで表示）
- 更新は上書きせず追加する。同じ対象・項目・valid_from の行は最新の登録が有効（`facts_current` ビュー）
- 卒業・移籍などは、古い値の行に valid_to を入れて取り込み直し、新しい値を別の行で追加する（有効期間が重なるとエラー）。古い期間の値は「古い」判定に使う
- 内容が変わらない行は「変更なし」として登録しない

## コスト管理の方針

- コストに効く設定はすべて `config/measurement.yaml` と `config/engines.yaml` に集約
- 頻度・試行回数・質問セットは顧客プランで決める。Basic / Pro でも重要質問は毎日ではなく **週2回**（仕様書の毎日だとコストの半分以上を占めるため）
- OpenAI は **flex（約半額）** を既定。混雑時は最終試行のみ通常料金にフォールバック
- Claude は動的フィルタリング付きの検索ツールで検索結果の入力トークンを削減、検索回数の上限 5
- 指名・新着の質問は計測対象だけに展開（競合は発見カテゴリの回答内で検出し、比較の質問にだけ使う）
- 実行前に必ず見積もり（`--dry-run`）。月間予算の80%で警告、100%で priority: normal を停止、110%で全停止
- 1回ごとの実費（トークン・検索回数・円換算）を `runs` に記録

## 使い方

```bash
npm install
cp .env.example .env   # APIキーと DATABASE_URL を設定

npm run sync                                   # 質問辞書・顧客・対象を検証して DB に同期
npm run facts:import -- facts.csv --dry-run    # 正解データの検証（登録しない）
npm run facts:import -- facts.csv              # 正解データの登録

npm run measure -- --dry-run                   # 今日の定期計測の見積もり（API を呼ばない）
npm run measure                                # 今日の定期計測（毎日 Cron から呼ぶ。各顧客のプランで対象を判定）
npm run measure -- --date 2026-12-01 --dry-run # 指定日の定期計測の見積もり
npm run measure -- --scope full --limit 30 --trials 5 --label acceptance   # 受け入れテスト: 30問×4エンジン×5試行
npm run measure -- --scope full --clients self # 顧客を指定して全質問を手動計測
npm run measure -- --limit 30 --scope full --mock  # 課金なしのモックで流れを確認

npm test          # 単体テスト
npm run typecheck
npm run estimate  # 月間予算のシナリオ比較
```

オプション: `--engines openai,claude`（エンジンを絞る）/ `--trials 3`（プランの試行回数を一律で上書き）/ `--force`（全体予算の上限を無視。顧客の原価上限は常に有効）

## 未完了・要確認

- `data/entities.yaml` は仮データ。テスト対象5組と競合が決まったら差し替える
- Gemini のレスポンス形式は公式ドキュメントを取得できていないため、実キーでの疎通時に確認する
- 定期実行（Vercel Cron + QStash）は未実装。現状は `npm run measure` を毎日1回実行する想定
- 画面（顧客レポート・顧客入力フォーム・運営コンソール）は未実装。仕組み（DB・ロジック）のみ実装済み
- `scripts/estimate-budget.ts` の単価は `config/pricing.json`（OpenAI flex の割引は未反映＝保守的）
