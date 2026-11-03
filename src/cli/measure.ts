// 計測の実行
//   npm run measure -- --scope full --dry-run            見積もりだけ（API を呼ばない・課金なし）
//   npm run measure -- --scope full --limit 30 --label acceptance   受け入れテスト（30問×4エンジン×試行回数）
//   npm run measure -- --scope priority                  priority: high の質問のみ
// オプション: --engines openai,claude  --trials 3  --mock（課金なしのモック）  --force（予算上限を無視）
import { ENGINE_NAMES, type EngineName, loadConfig } from "../config.ts";
import { createEngines } from "../engines/index.ts";
import { MockEngine } from "../engines/mock.ts";
import { estimateCallUsd } from "../pricing.ts";
import { expandPrompts, loadEntities, loadQuestions } from "../questions/index.ts";
import { BudgetGuard } from "../runner/budget.ts";
import { type Scope, buildPlan, estimatePlan } from "../runner/plan.ts";
import { runMeasurement } from "../runner/run.ts";
import { ROOT, openStorage, parseArgs } from "./common.ts";

const args = parseArgs(process.argv.slice(2));
const scope = (args.scope ?? "full") as Scope;
if (scope !== "full" && scope !== "priority") throw new Error(`--scope は full か priority: ${scope}`);
const only = typeof args.engines === "string" ? (args.engines.split(",") as EngineName[]) : undefined;
for (const e of only ?? []) if (!ENGINE_NAMES.includes(e)) throw new Error(`未知のエンジン: ${e}`);
const trials = typeof args.trials === "string" ? Number(args.trials) : undefined;
const limitPrompts = typeof args.limit === "string" ? Number(args.limit) : undefined;

const config = loadConfig();
const fx = config.measurement.budget.fx_jpy_per_usd;
const yen = (usd: number) => `¥${Math.round(usd * fx).toLocaleString()}`;
const questions = loadQuestions(`${ROOT}questions`);
const entities = loadEntities(typeof args.entities === "string" ? args.entities : `${ROOT}data/entities.yaml`);
const prompts = expandPrompts(questions, entities.entities);
const engineNames = ENGINE_NAMES.filter((n) => config.engines[n].enabled && (!only || only.includes(n)));

const { storage, label } = openStorage({ mock: !!args.mock });
try {
  if (args["dry-run"]) {
    const jobs = buildPlan(prompts, { scope, engines: engineNames, trials: trials ?? config.measurement.trials, limitPrompts });
    const est = estimatePlan(jobs, config.engines);
    const budget = new BudgetGuard(config.measurement.budget, await storage.monthToDateCostUsd(new Date()), () => {});
    const snap = budget.snapshot();
    console.log(`[見積もり] scope=${scope} / ${est.prompts}問 × ${engineNames.length}エンジン × ${trials ?? config.measurement.trials}試行 = ${est.calls}回`);
    for (const [e, v] of Object.entries(est.byEngine)) {
      console.log(`  ${e.padEnd(10)} ${String(v.calls).padStart(6)}回 × ${yen(estimateCallUsd(config.engines, e as EngineName))} = ${yen(v.usd)}`);
    }
    console.log(`  合計 ${yen(est.totalUsd)}（$${est.totalUsd.toFixed(2)}）`);
    console.log(`[予算] 今月の使用 ${yen(snap.spentUsd)} / 上限 ¥${snap.capJpy.toLocaleString()} → 実行後 ${(((snap.spentUsd + est.totalUsd) / snap.capUsd) * 100).toFixed(1)}%`);
    console.log("※ 1回あたりの単価は想定値です。実費は計測後に runs.cost_jpy で確認してください。");
  } else {
    const engines = args.mock ? engineNames.map((n) => new MockEngine(n)) : createEngines(config.engines, engineNames);
    console.log(`保存先: ${label}${args.mock ? " / モックエンジン（課金なし）" : ""}`);
    const s = await runMeasurement({
      config, engines, storage, prompts, scope, trials, limitPrompts,
      force: !!args.force, label: typeof args.label === "string" ? args.label : undefined,
    });
    console.log(`\n[結果] ${s.measurementId}`);
    console.log(`  成功 ${s.ok} / 失敗 ${s.failed} / 保存失敗 ${s.storageErrors} / 予算停止 ${s.skippedBudget}（計画 ${s.plannedCalls}）`);
    console.log(`  欠損率 ${(s.missingRate * 100).toFixed(2)}% ${s.missingRateOk ? "OK" : `NG（目標 ${config.measurement.max_missing_rate * 100}% 以下）`}`);
    console.log(`  費用 ${yen(s.costUsd)}（見積 ${yen(s.estimatedUsd)}）`);
    for (const [e, v] of Object.entries(s.byEngine)) {
      const per = v.ok ? v.costUsd / v.ok : 0;
      console.log(`    ${e.padEnd(10)} 成功${v.ok} 失敗${v.failed} 費用${yen(v.costUsd)}（1回 ${yen(per)}・検索 ${v.ok ? (v.searchCount / v.ok).toFixed(1) : "-"}回）`);
    }
    console.log(`  今月の使用 ${yen(s.budget.spentUsd)} / 上限 ¥${s.budget.capJpy.toLocaleString()}（${(s.budget.ratio * 100).toFixed(1)}%）`);
    if (!s.missingRateOk) process.exitCode = 2;
  }
} finally {
  await storage.close();
}
