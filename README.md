# エンタメGEO

生成AI（ChatGPT系 / Gemini / Perplexity / Claude）の回答を「正確性・鮮度・推薦」の3軸で計測するシステム（MVP開発中）。

## API予算の概算

```
node --experimental-strip-types --no-warnings scripts/estimate-budget.ts
```

- 単価: `config/pricing.json`（`status: unverified` は二次情報。各社管理画面で確認して更新する）
- 質問数・試行回数・トークン前提: `scripts/estimate-budget.ts` 冒頭の定数
