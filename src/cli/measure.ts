// 計測の実行
//   npm run measure -- --dry-run                     今日（日本時間）の定期計測の見積もりのみ（API を呼ばない・課金なし）
//   npm run measure                                  今日の定期計測（Cron から毎日呼ぶ）。各顧客のプランの頻度で対象を決める
//   npm run measure -- --date 2026-12-01 --dry-run   指定日の定期計測の見積もり
//   npm run measure -- --scope full --limit 30 --label acceptance   受け入れテスト（全顧客の質問から30問）
//   npm run measure -- --scope priority              priority: high の追加計測（手動）
// オプション: --clients a,b  --engines openai,claude  --trials 3  --mock（課金なしのモック）  --force（予算上限を無視）
import { ENGINE_NAMES, type EngineName, loadConfig } from "../config.ts";
import { createEngines } from "../engines/index.ts";
import { MockEngine } from "../engines/mock.ts";
import { type SelectionMode, jstCalendar, selectPrompts } from "../plans.ts";
import { expandPrompts, loadEntities, loadQuestions } from "../questions/index.ts";
import { BudgetGuard } from "../runner/budget.ts";
import { buildPlan, estimatePlan } from "../runner/plan.ts";
import { runMeasurement } from "../runner/run.ts";
import { ROOT, openStorage, parseArgs } from "./common.ts";

const args = parseArgs(process.argv.slice(2));
const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : undefined);
const scope = str("scope") ?? "scheduled";
const date = str("date");
if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date は YYYY-MM-DD: ${date}`);
const now = date ? new Date(`${date}T12:00:00+09:00`) : new Date();
let mode: SelectionMode;
if (scope === "scheduled") mode = { kind: "scheduled", now };
else if (scope === "full" || scope === "priority") mode = { kind: scope };
else throw new Error(`--scope は scheduled / full / priority: ${scope}`);
const only = str("engines")?.split(",") as EngineName[] | undefined;
for (const e of only ?? []) if (!ENGINE_NAMES.includes(e)) throw new Error(`未知のエンジン: ${e}`);
const clients = str("clients")?.split(",");
const trials = str("trials") ? Number(str("trials")) : undefined;
const limitPrompts = str("limit") ? Number(str("limit")) : undefined;

const config = loadConfig();
const fx = config.measurement.budget.fx_jpy_per_usd;
const yen = (usd: number) => `¥${Math.round(usd * fx).toLocaleString()}`;
const questions = loadQuestions(`${ROOT}questions`, config.factKeys);
const entities = loadEntities(str("entities") ?? `${ROOT}data/entities.yaml`, config.plans);
for (const c of clients ?? []) if (!entities.clients.some((x) => x.id === c)) throw new Error(`未知の顧客: ${c}`);
const prompts = expandPrompts(questions, entities, config.plans);
const selection = selectPrompts(prompts, entities, config.plans, mode, { clients });
const engineNames = ENGINE_NAMES.filter((n) => config.engines[n].enabled && (!only || only.includes(n)));
const clientName = new Map(entities.clients.map((c) => [c.id, `${c.name}（${config.plans.plans[c.plan].label}）`]));
const label = scope === "scheduled" ? `scheduled ${jstCalendar(now).ymd}` : scope;

if (selection.length === 0) {
  console.log(`[計測] ${label}: 計測日にあたる顧客がいないため、実行する質問はありません`);
  process.exit(0);
}

const { storage, label: storageLabel } = openStorage({ mock: !!args.mock });
try {
  if (args["dry-run"]) {
    const jobs = buildPlan(selection, { engines: engineNames, trials, limitPrompts });
    const est = estimatePlan(jobs, config.engines);
    const budget = new BudgetGuard(config.measurement.budget, await storage.monthToDateCostUsd(now), () => {});
    const byClientMtd = await storage.monthToDateCostUsdByClient(now);
    const snap = budget.snapshot();
    console.log(`[見積もり] ${label} / ${est.prompts}問 → ${est.calls}回`);
    for (const [e, v] of Object.entries(est.byEngine)) console.log(`  ${e.padEnd(10)} ${String(v.calls).padStart(6)}回  ${yen(v.usd)}`);
    console.log(`  合計 ${yen(est.totalUsd)}（$${est.totalUsd.toFixed(2)}）`);
    console.log("[顧客別]（発見カテゴリの費用は同じ業界の顧客で按分）");
    for (const [c, usd] of Object.entries(est.byClient)) {
      const cap = config.plans.plans[entities.clients.find((x) => x.id === c)!.plan].monthly_cost_cap_jpy;
      const after = ((byClientMtd[c] ?? 0) + usd) * fx;
      console.log(`  ${clientName.get(c)}: 今回 ${yen(usd)} / 今月の累計見込み ¥${Math.round(after).toLocaleString()} / 上限 ¥${cap.toLocaleString()}${after > cap ? " ← 上限超過分は実行されません" : ""}`);
    }
    console.log(`[全体予算] 今月の使用 ${yen(snap.spentUsd)} / 上限 ¥${snap.capJpy.toLocaleString()} → 実行後 ${(((snap.spentUsd + est.totalUsd) / snap.capUsd) * 100).toFixed(1)}%`);
    console.log("※ 1回あたりの単価は想定値です。実費は計測後に runs.cost_jpy で確認してください。");
  } else {
    const engines = args.mock ? engineNames.map((n) => new MockEngine(n)) : createEngines(config.engines, engineNames);
    console.log(`保存先: ${storageLabel}${args.mock ? " / モックエンジン（課金なし）" : ""}`);
    const s = await runMeasurement({
      config, engines, storage, selection, entities, scope, trials, limitPrompts,
      force: !!args.force, label: str("label") ?? (scope === "scheduled" ? `scheduled-${jstCalendar(now).ymd}` : undefined),
    });
    console.log(`\n[結果] ${s.measurementId}`);
    console.log(`  成功 ${s.ok} / 失敗 ${s.failed} / 保存失敗 ${s.storageErrors} / 予算停止 ${s.skippedBudget}（計画 ${s.plannedCalls}）`);
    console.log(`  欠損率 ${(s.missingRate * 100).toFixed(2)}% ${s.missingRateOk ? "OK" : `NG（目標 ${config.measurement.max_missing_rate * 100}% 以下）`}`);
    console.log(`  費用 ${yen(s.costUsd)}（見積 ${yen(s.estimatedUsd)}）`);
    for (const [e, v] of Object.entries(s.byEngine)) {
      const per = v.ok ? v.costUsd / v.ok : 0;
      console.log(`    ${e.padEnd(10)} 成功${v.ok} 失敗${v.failed} 費用${yen(v.costUsd)}（1回 ${yen(per)}・検索 ${v.ok ? (v.searchCount / v.ok).toFixed(1) : "-"}回）`);
    }
    for (const [c, v] of Object.entries(s.byClient)) {
      console.log(`    ${clientName.get(c)}: 今回 ${yen(v.costUsd)} / 今月 ¥${v.spentJpy.toLocaleString()} / 上限 ¥${v.capJpy.toLocaleString()}`);
    }
    console.log(`  全体の今月の使用 ${yen(s.budget.spentUsd)} / 上限 ¥${s.budget.capJpy.toLocaleString()}（${(s.budget.ratio * 100).toFixed(1)}%）`);
    if (!s.missingRateOk) process.exitCode = 2;
  }
} finally {
  await storage.close();
}
