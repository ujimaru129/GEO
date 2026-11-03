# エンタメGEO

生成AI（ChatGPT系 / Gemini / Perplexity / Claude）の回答を「正確性・鮮度・推薦」の3軸で計測するシステム（MVP開発中）。

## API予算の概算

```
node --experimental-strip-types --no-warnings scripts/estimate-budget.ts
```

- 単価: `config/pricing.json`（各社公式ページで確認済み。出典URLは同ファイル内 `sources`）
- 質問数・試行回数・トークン前提: `scripts/estimate-budget.ts` 冒頭の定数
