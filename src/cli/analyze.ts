// 回答の解析（フェーズB）: 言及・引用元（ルール、費用なし）と正誤の判定（小型 LLM）
//   npm run analyze                           未解析の回答をすべて解析する（計測の後に実行）
//   npm run analyze -- --measurement <計測ID>  指定した計測の回答だけ
//   npm run analyze -- --dry-run               対象件数と判定の見込み費用だけ（API を呼ばない）
//   npm run analyze -- --no-judge              正誤の判定をしない（言及と引用元だけ。費用なし）
// オプション: --limit 100（先頭から N 件）  --mock（data/local-mock を対象にし、判定はモック）
import { analyzeRuns, planAnalysis } from "../analysis/index.ts";
import { type ClaimJudge, OpenAIClaimJudge } from "../analysis/claims.ts";
import { loadConfig } from "../config.ts";
import { loadEntities, loadQuestions } from "../questions/index.ts";
import { ROOT, openStorage, parseArgs } from "./common.ts";

const args = parseArgs(process.argv.slice(2));
const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : undefined);
const config = loadConfig();
const fx = config.measurement.budget.fx_jpy_per_usd;
const version = config.analysis.version;
const questions = loadQuestions(`${ROOT}questions`, config.factKeys, config.industries);
const entities = loadEntities(str("entities") ?? `${ROOT}data/entities.yaml`, config.plans, config.industries);
const measurementId = str("measurement");
const limit = str("limit") ? Number(str("limit")) : undefined;

/** 課金なしのモック: 正解データの current と同じ文言が回答にあれば correct とする */
const mockJudge: ClaimJudge = {
  async judge(input) {
    const claims = input.facts
      .filter((f) => f.current && input.answer.includes(f.current))
      .map((f) => ({ factKey: f.key, statement: `${f.label}は${f.current}`, normalized: `${f.key}-current`, verdict: "correct" as const, confidence: 1, evidence: f.current! }));
    return { claims, model: "mock", inputTokens: 0, outputTokens: 0, costUsd: 0 };
  },
};

const { storage, label } = openStorage({ mock: !!args.mock });
try {
  const facts = await storage.listFacts();
  const targets = await storage.listUnanalyzed(version, { measurementId, limit });
  console.log(`保存先: ${label} / 解析方法 ${version}`);
  if (targets.length === 0) {
    console.log("[解析] 未解析の回答はありません");
  } else if (args["dry-run"]) {
    const planned = planAnalysis(targets, { config, entities, facts, questions });
    const judged = planned.filter((p) => p.judgeInput).length;
    // 1回あたり 入力 1,500・出力 600 トークンの想定（2026-11 の実測: 入力 約900・出力 約550）
    const p = config.analysis.llm.pricing;
    const mult = config.analysis.llm.service_tier === "flex" ? p.flex_token_multiplier : 1;
    const usd = (judged * (1500 * p.input_per_mtok + 600 * p.output_per_mtok) * mult) / 1e6;
    console.log(`[見積もり] 回答 ${targets.length}件 / うち正誤の判定 ${judged}件 → 約 ¥${(usd * fx).toFixed(1)}`);
    console.log(`  言及 ${planned.reduce((s, x) => s + x.mentions.length, 0)}件 / 引用 ${planned.reduce((s, x) => s + x.citations.length, 0)}件（ルール、費用なし）`);
  } else {
    const judge: ClaimJudge | null = args["no-judge"] ? null : args.mock ? mockJudge : new OpenAIClaimJudge(config.analysis);
    console.log(`[解析] 回答 ${targets.length}件${judge ? "" : "（正誤の判定なし）"}`);
    const res = await analyzeRuns(targets, { config, entities, facts, questions, judge, measurementId: measurementId ?? null, log: console.log });
    await storage.saveAnalysis(res);
    const b = res.batch;
    const verdicts = res.claims.reduce<Record<string, number>>((m, c) => ((m[c.verdict] = (m[c.verdict] ?? 0) + 1), m), {});
    const types = res.citations.reduce<Record<string, number>>((m, c) => ((m[c.sourceType] = (m[c.sourceType] ?? 0) + 1), m), {});
    console.log(`\n[結果] ${b.id}`);
    console.log(`  解析済み ${b.runIds.length}件 / 判定の失敗 ${b.llmFailed}件（次回やり直し）`);
    console.log(`  言及 ${res.mentions.length}件 / 引用 ${res.citations.length}件 ${JSON.stringify(types)}`);
    console.log(`  判定 ${b.llmCalls}回 → 主張 ${res.claims.length}件 ${JSON.stringify(verdicts)}`);
    console.log(`  費用 ¥${b.costJpy.toFixed(1)}（入力 ${b.inputTokens.toLocaleString()} / 出力 ${b.outputTokens.toLocaleString()} トークン${b.model ? ` / ${b.model}` : ""}）`);
  }
} finally {
  await storage.close();
}
