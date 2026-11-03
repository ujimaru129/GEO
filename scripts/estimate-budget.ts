// 月間API予算の概算。実行: node --experimental-strip-types scripts/estimate-budget.ts
// 単価は config/pricing.json、前提値はこのファイル内の ASSUMPTIONS / SCENARIOS / ENGINE_SETS。
import { readFileSync } from "node:fs";

type EnginePrice = {
  label: string;
  input_per_mtok: number;
  output_per_mtok: number;
  search_per_1k?: number;
  search_free_per_month?: number;
  search_content_vendor: "openai" | "claude" | "perplexity" | null; // null = 検索結果の入力トークンは無料
};

const pricing = JSON.parse(
  readFileSync(new URL("../config/pricing.json", import.meta.url), "utf8"),
);
const FX: number = pricing.fx_jpy_per_usd;

// 1回の問い合わせあたりのトークン・検索回数の前提
const ASSUMPTIONS = {
  base: {
    promptTokens: 100,
    outputTokens: 1500,
    reasoningTokens: 1000, // 思考型モデルの非表示出力（出力単価で課金）
    searchesPerCall: 2,
    contentTokensPerSearch: { openai: 4000, claude: 10000, perplexity: 3000 }, // 検索結果が入力として課金される分
  },
  pessimistic: {
    promptTokens: 100,
    outputTokens: 2500,
    reasoningTokens: 3000,
    searchesPerCall: 4,
    contentTokensPerSearch: { openai: 6000, claude: 15000, perplexity: 5000 },
  },
} as const;
type Assumption = (typeof ASSUMPTIONS)[keyof typeof ASSUMPTIONS];

const RETRY_OVERHEAD = 0.05; // 失敗・リトライ分
const ANALYZED_SHARE = 0.7; // LLM解析にかける回答の割合（指名・比較・新着）
const ANALYZER_TOKENS = { input: 3500, output: 800 };
const INFRA_USD = 60; // Vercel Pro + Supabase Pro + QStash
const WEEKS_PER_MONTH = 4.33;
const DAYS_PER_MONTH = 30;

// extraRunsPerMonth: 週次の全件計測とは別に、priority: high を追加で回す回数（月あたり）
const SCENARIOS = {
  "仕様書どおり（重要は毎日）": { weeklyQ: 150, weeklyTrials: 5, dailyQ: 30, dailyTrials: 5, extraRunsPerMonth: DAYS_PER_MONTH - WEEKS_PER_MONTH },
  "現行設定（重要は週2回）": { weeklyQ: 150, weeklyTrials: 5, dailyQ: 30, dailyTrials: 5, extraRunsPerMonth: WEEKS_PER_MONTH },
  "現行設定・試行3回": { weeklyQ: 150, weeklyTrials: 3, dailyQ: 30, dailyTrials: 3, extraRunsPerMonth: WEEKS_PER_MONTH },
  "最小（週1全件×3回のみ）": { weeklyQ: 150, weeklyTrials: 3, dailyQ: 0, dailyTrials: 0, extraRunsPerMonth: 0 },
};

const ENGINE_SETS: Record<string, string[]> = {
  "一般ユーザー準拠": ["openai_gpt61_sol", "gemini_38_flash", "perplexity_sonar", "claude_sonnet55"],
  "節約モデル": ["openai_gpt6_luna", "gemini_38_flash", "perplexity_sonar", "claude_haiku55"],
  "最上位モデル": ["openai_gpt6_astra", "gemini_31_pro", "perplexity_sonar", "claude_sonnet55"],
};

function perCall(key: string, a: Assumption) {
  const p: EnginePrice = pricing.engines[key];
  const vendor = p.search_content_vendor;
  const contentTokens = vendor ? a.searchesPerCall * a.contentTokensPerSearch[vendor] : 0;
  const inTok = a.promptTokens + contentTokens;
  const outTok = a.outputTokens + a.reasoningTokens;
  const tokens = (inTok * p.input_per_mtok + outTok * p.output_per_mtok) / 1e6;
  const searches = p.search_per_1k ? (a.searchesPerCall * p.search_per_1k) / 1000 : 0;
  const request = 0;
  return { tokens, searches, request, total: tokens + searches + request, searchCount: a.searchesPerCall };
}

function monthly(setName: string, scen: (typeof SCENARIOS)[keyof typeof SCENARIOS], a: Assumption) {
  const dailyDays = scen.extraRunsPerMonth;
  const callsPerEngine =
    (scen.weeklyQ * scen.weeklyTrials * WEEKS_PER_MONTH + scen.dailyQ * scen.dailyTrials * dailyDays) *
    (1 + RETRY_OVERHEAD);
  let measure = 0;
  const byEngine: Record<string, number> = {};
  for (const key of ENGINE_SETS[setName]) {
    const c = perCall(key, a);
    let cost = c.total * callsPerEngine;
    const p: EnginePrice = pricing.engines[key];
    if (p.search_free_per_month && p.search_per_1k) {
      const free = Math.min(p.search_free_per_month, c.searchCount * callsPerEngine);
      cost -= (free * p.search_per_1k) / 1000;
    }
    byEngine[p.label] = cost;
    measure += cost;
  }
  const responses = callsPerEngine * ENGINE_SETS[setName].length;
  const an = pricing.analyzer;
  const analysis =
    responses * ANALYZED_SHARE *
    ((ANALYZER_TOKENS.input * an.input_per_mtok + ANALYZER_TOKENS.output * an.output_per_mtok) / 1e6);
  return { callsPerEngine, responses, measure, analysis, infra: INFRA_USD, total: measure + analysis + INFRA_USD, byEngine };
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 0)}`;
const jpy = (n: number) => `${Math.round((n * FX) / 1000).toLocaleString()}千円`;

for (const [aName, a] of Object.entries(ASSUMPTIONS)) {
  console.log(`\n=== 前提: ${aName} ===`);
  console.log("1回あたり単価:");
  for (const key of new Set(Object.values(ENGINE_SETS).flat())) {
    const c = perCall(key, a);
    console.log(
      `  ${pricing.engines[key].label}: ${usd(c.total)} (tokens ${usd(c.tokens)} / search ${usd(c.searches)})`,
    );
  }
  for (const setName of Object.keys(ENGINE_SETS)) {
    for (const [sName, s] of Object.entries(SCENARIOS)) {
      const m = monthly(setName, s, a);
      console.log(
        `  [${setName}] ${sName}: 計測${usd(m.measure)} + 解析${usd(m.analysis)} + インフラ${usd(m.infra)} = ${usd(m.total)} (${jpy(m.total)}) / 呼び出し ${Math.round(m.responses).toLocaleString()}回`,
      );
      for (const [l, v] of Object.entries(m.byEngine)) console.log(`      - ${l}: ${usd(v)}`);
    }
  }
}

// フェーズA受け入れテスト（30問×4エンジン×5試行）
for (const [aName, a] of Object.entries(ASSUMPTIONS)) {
  const t = ENGINE_SETS["一般ユーザー準拠"].reduce((s, k) => s + perCall(k, a).total * 30 * 5, 0);
  console.log(`\nフェーズA受け入れテスト(${aName}): ${usd(t)} (${jpy(t)})`);
}
