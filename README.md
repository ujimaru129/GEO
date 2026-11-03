# エンタメGEO

生成AI（ChatGPT系 / Gemini / Perplexity / Claude）の回答を「正確性・鮮度・推薦」の3軸で計測するシステム（MVP開発中）。

## 現在の状態: フェーズA（計測エンジン）

| 機能 | 場所 |
| --- | --- |
| DBスキーマ（Supabase/Postgres） | `db/migrations/0001_init.sql` |
| 質問辞書（業界別YAML）と計測対象 | `questions/*.yaml`, `data/entities.yaml` |
| 4エンジンの共通クライアント（モデル名・単価は設定で差し替え） | `src/engines/`, `config/engines.yaml` |
| 並列実行・リトライ（最大3回）・費用記録・月間予算上限 | `src/runner/`, `config/measurement.yaml` |

## コスト管理の方針

- コストに効く設定はすべて `config/measurement.yaml` と `config/engines.yaml` に集約
- 重要質問は毎日ではなく **週2回**（仕様書の毎日だとコストの半分以上を占めるため）
- OpenAI は **flex（約半額）** を既定。混雑時は最終試行のみ通常料金にフォールバック
- Claude は動的フィルタリング付きの検索ツールで検索結果の入力トークンを削減、検索回数の上限 5
- 指名・新着の質問は計測対象だけに展開（競合は発見カテゴリの回答内で検出し、比較の質問にだけ使う）
- 実行前に必ず見積もり（`--dry-run`）。月間予算の80%で警告、100%で priority: normal を停止、110%で全停止
- 1回ごとの実費（トークン・検索回数・円換算）を `runs` に記録

## 使い方

```bash
npm install
cp .env.example .env   # APIキーと DATABASE_URL を設定

npm run sync                                   # 質問辞書・対象を検証して DB に同期
npm run measure -- --scope full --dry-run      # 見積もりのみ（API を呼ばない）
npm run measure -- --limit 30 --label acceptance   # 受け入れテスト: 30問×4エンジン×5試行
npm run measure -- --scope priority            # priority: high のみ（週2回の定期実行用）
npm run measure -- --limit 30 --mock           # 課金なしのモックで流れを確認

npm test          # 単体テスト
npm run typecheck
npm run estimate  # 月間予算のシナリオ比較
```

オプション: `--engines openai,claude`（エンジンを絞る）/ `--trials 3`（試行回数の上書き）/ `--force`（予算上限を無視）

## 未完了・要確認

- `data/entities.yaml` は仮データ。テスト対象5組と競合が決まったら差し替える
- Gemini のレスポンス形式は公式ドキュメントを取得できていないため、実キーでの疎通時に確認する
- 定期実行（Vercel Cron + QStash）は未実装。現状は CLI で1コマンド実行
- `scripts/estimate-budget.ts` の単価は `config/pricing.json`（OpenAI flex の割引は未反映＝保守的）
