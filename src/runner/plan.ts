import type { EngineName, EnginesConfig } from "../config.ts";
import type { SelectedPrompt } from "../plans.ts";
import { estimateCallUsd } from "../pricing.ts";
import type { Prompt } from "../questions/index.ts";

export type Job = {
  prompt: Prompt;
  engine: EngineName;
  trialNo: number;
  /** この実行の費用を按分する顧客 */
  clientIds: string[];
};

export type PlanOptions = {
  /** CLI の --engines で絞る場合 */
  engines?: EngineName[];
  /** プランの試行回数を一律で上書きする場合（--trials） */
  trials?: number;
  /** 受け入れテストなど、質問数を絞って回すとき（先頭から N 件の prompt） */
  limitPrompts?: number;
};

export function buildPlan(selection: SelectedPrompt[], opts: PlanOptions = {}): Job[] {
  // 予算超過時に normal から止めるため、high を先に実行する
  let selected = [...selection].sort((a, b) =>
    a.prompt.priority === b.prompt.priority ? 0 : a.prompt.priority === "high" ? -1 : 1,
  );
  if (opts.limitPrompts !== undefined) selected = selected.slice(0, opts.limitPrompts);
  const maxTrials = Math.max(0, ...selected.map((s) => opts.trials ?? s.trials));
  const jobs: Job[] = [];
  // 試行番号を外側に回し、エンジン×質問の各試行が時間的に分散するようにする
  for (let trialNo = 1; trialNo <= maxTrials; trialNo++) {
    for (const s of selected) {
      if (trialNo > (opts.trials ?? s.trials)) continue;
      for (const [engine, engineClientIds] of Object.entries(s.engineClients) as [EngineName, string[]][]) {
        if (opts.engines && !opts.engines.includes(engine)) continue;
        // 例: 標準(5回)とお試し(3回)の共有質問の4・5回目は、標準の顧客だけが負担する
        const clientIds = opts.trials ? engineClientIds : engineClientIds.filter((c) => trialNo <= (s.clientTrials[c] ?? s.trials));
        if (clientIds.length === 0) continue;
        jobs.push({ prompt: s.prompt, engine, trialNo, clientIds });
      }
    }
  }
  return jobs;
}

export type PlanEstimate = {
  prompts: number;
  calls: number;
  byEngine: Record<string, { calls: number; usd: number }>;
  /** 顧客ごとの按分後の見積額 */
  byClient: Record<string, number>;
  totalUsd: number;
};

export function estimatePlan(jobs: Job[], engines: EnginesConfig): PlanEstimate {
  const byEngine: PlanEstimate["byEngine"] = {};
  const byClient: PlanEstimate["byClient"] = {};
  for (const j of jobs) {
    const usd = estimateCallUsd(engines, j.engine);
    const e = (byEngine[j.engine] ??= { calls: 0, usd: 0 });
    e.calls++;
    e.usd += usd;
    for (const c of j.clientIds) byClient[c] = (byClient[c] ?? 0) + usd / j.clientIds.length;
  }
  return {
    prompts: new Set(jobs.map((j) => j.prompt.key)).size,
    calls: jobs.length,
    byEngine,
    byClient,
    totalUsd: Object.values(byEngine).reduce((s, e) => s + e.usd, 0),
  };
}
