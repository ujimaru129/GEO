import type { EngineName, EnginesConfig } from "../config.ts";
import { estimateCallUsd } from "../pricing.ts";
import type { Prompt } from "../questions/index.ts";

export type Scope = "full" | "priority";

export type Job = { prompt: Prompt; engine: EngineName; trialNo: number };

export type PlanOptions = {
  scope: Scope;
  engines: EngineName[];
  trials: number;
  /** 受け入れテストなど、質問数を絞って回すとき（先頭から N 件の prompt） */
  limitPrompts?: number;
};

export function buildPlan(prompts: Prompt[], opts: PlanOptions): Job[] {
  let selected = opts.scope === "priority" ? prompts.filter((p) => p.priority === "high") : prompts;
  // 予算超過時に normal から止めるため、high を先に実行する
  selected = [...selected].sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "high" ? -1 : 1));
  if (opts.limitPrompts !== undefined) selected = selected.slice(0, opts.limitPrompts);
  const jobs: Job[] = [];
  // 試行番号を外側に回し、エンジン×質問の各試行が時間的に分散するようにする
  for (let trialNo = 1; trialNo <= opts.trials; trialNo++) {
    for (const prompt of selected) for (const engine of opts.engines) jobs.push({ prompt, engine, trialNo });
  }
  return jobs;
}

export type PlanEstimate = {
  prompts: number;
  calls: number;
  byEngine: Record<string, { calls: number; usd: number }>;
  totalUsd: number;
};

export function estimatePlan(jobs: Job[], engines: EnginesConfig): PlanEstimate {
  const byEngine: PlanEstimate["byEngine"] = {};
  for (const j of jobs) {
    const e = (byEngine[j.engine] ??= { calls: 0, usd: 0 });
    e.calls++;
    e.usd += estimateCallUsd(engines, j.engine);
  }
  return {
    prompts: new Set(jobs.map((j) => j.prompt.key)).size,
    calls: jobs.length,
    byEngine,
    totalUsd: Object.values(byEngine).reduce((s, e) => s + e.usd, 0),
  };
}
