import { randomUUID } from "node:crypto";
import type { AppConfig, EngineName } from "../config.ts";
import type { EngineClient, EngineResult } from "../engines/types.ts";
import { computeCost, estimateCallUsd } from "../pricing.ts";
import type { Prompt } from "../questions/index.ts";
import type { RunRecord, Storage } from "../storage/types.ts";
import { BudgetGuard } from "./budget.ts";
import { type Job, type Scope, buildPlan, estimatePlan } from "./plan.ts";
import { RetryExhaustedError, withRetry } from "./retry.ts";

export type RunOptions = {
  config: AppConfig;
  engines: EngineClient[];
  storage: Storage;
  prompts: Prompt[];
  scope: Scope;
  trials?: number;
  limitPrompts?: number;
  /** 見積額が残り予算を超えていても実行する */
  force?: boolean;
  label?: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
};

export type MeasurementSummary = {
  measurementId: string;
  plannedCalls: number;
  ok: number;
  failed: number;
  skippedBudget: number;
  storageErrors: number;
  /** 欠損率 =（失敗＋保存失敗）÷ 実行数。予算停止分は別集計 */
  missingRate: number;
  missingRateOk: boolean;
  costUsd: number;
  costJpy: number;
  estimatedUsd: number;
  byEngine: Record<string, { ok: number; failed: number; skippedBudget: number; costUsd: number; searchCount: number }>;
  budget: ReturnType<BudgetGuard["snapshot"]>;
};

export class BudgetExceededError extends Error {}

export async function runMeasurement(opts: RunOptions): Promise<MeasurementSummary> {
  const { config, storage } = opts;
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? console.log;
  const m = config.measurement;
  const engineByName = new Map(opts.engines.map((e) => [e.name, e]));
  const jobs = buildPlan(opts.prompts, {
    scope: opts.scope,
    engines: [...engineByName.keys()],
    trials: opts.trials ?? m.trials,
    limitPrompts: opts.limitPrompts,
  });
  const estimate = estimatePlan(jobs, config.engines);
  const budget = new BudgetGuard(m.budget, await storage.monthToDateCostUsd(now()), log);

  if (!opts.force && budget.stateFor(estimate.totalUsd) === "stop_all") {
    throw new BudgetExceededError(
      `見積額 $${estimate.totalUsd.toFixed(2)} を実行すると月間予算の上限（${m.budget.hard_stop_ratio * 100}%）を超えます。` +
        `質問数・試行回数を減らすか --force で実行してください`,
    );
  }

  const measurementId = `${opts.label ?? opts.scope}-${now().toISOString().replace(/[:.]/g, "-")}`;
  await storage.saveConfigSnapshot(config.snapshotHash, config.snapshot);
  await storage.createMeasurement({
    id: measurementId,
    scope: opts.scope,
    startedAt: now().toISOString(),
    configHash: config.snapshotHash,
    plannedCalls: jobs.length,
    estimatedUsd: estimate.totalUsd,
  });
  log(`[計測] ${measurementId}: ${estimate.prompts}問 × ${engineByName.size}エンジン × 試行 → ${jobs.length}回 / 見積 $${estimate.totalUsd.toFixed(2)}`);

  const summary: MeasurementSummary = {
    measurementId,
    plannedCalls: jobs.length,
    ok: 0,
    failed: 0,
    skippedBudget: 0,
    storageErrors: 0,
    missingRate: 0,
    missingRateOk: true,
    costUsd: 0,
    costJpy: 0,
    estimatedUsd: estimate.totalUsd,
    byEngine: {},
    budget: budget.snapshot(),
  };

  const globalSem = new Semaphore(m.concurrency.global);
  const engineSems = new Map<EngineName, Semaphore>(
    [...engineByName.keys()].map((n) => [n, new Semaphore(m.concurrency.per_engine[n] ?? 1)]),
  );
  let done = 0;

  const execute = async (job: Job) => {
    const engine = engineByName.get(job.engine)!;
    const reserve = estimateCallUsd(config.engines, job.engine);
    const base = {
      id: randomUUID(),
      measurementId,
      promptKey: job.prompt.key,
      questionId: job.prompt.questionId,
      entityId: job.prompt.entityId,
      competitorId: job.prompt.competitorId,
      variant: job.prompt.variant,
      promptText: job.prompt.text,
      engine: job.engine,
      trialNo: job.trialNo,
      configHash: config.snapshotHash,
    };
    const stats = (summary.byEngine[job.engine] ??= { ok: 0, failed: 0, skippedBudget: 0, costUsd: 0, searchCount: 0 });

    if (!budget.tryReserve(reserve, job.prompt.priority)) {
      await storage.recordRun(
        { ...base, model: null, executedAt: now().toISOString(), status: "skipped_budget", attempts: 0, latencyMs: null,
          inputTokens: null, outputTokens: null, reasoningTokens: null, searchCount: null, costUsd: 0, costJpy: 0,
          error: "月間予算の上限に達したため未実行" },
        null,
      );
      summary.skippedBudget++;
      stats.skippedBudget++;
      return;
    }

    const started = Date.now();
    const executedAt = now().toISOString();
    let outcome: { ok: true; result: EngineResult; attempts: number } | { ok: false; error: unknown; attempts: number };
    try {
      const { value, attempts } = await withRetry(
        (_attempt, isLast) => engine.ask(job.prompt.text, { signal: AbortSignal.timeout(m.retry.timeout_ms), preferReliability: isLast }),
        { maxAttempts: m.retry.max_attempts, baseDelayMs: m.retry.base_delay_ms, sleep: opts.sleep },
      );
      outcome = { ok: true, result: value, attempts };
    } catch (err) {
      outcome = { ok: false, error: err, attempts: err instanceof RetryExhaustedError ? err.attempts : 1 };
    }

    if (outcome.ok) {
      const { result } = outcome;
      const cost = computeCost(config.engines[job.engine].pricing, result.usage);
      budget.settle(reserve, cost.totalUsd);
      // 費用は保存の成否に関係なく発生しているので先に計上する
      stats.costUsd += cost.totalUsd;
      stats.searchCount += result.usage.searchCount;
      summary.costUsd += cost.totalUsd;
      const run: RunRecord = {
        ...base, model: result.model, executedAt, status: "ok", attempts: outcome.attempts, latencyMs: Date.now() - started,
        inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
        reasoningTokens: result.usage.reasoningTokens ?? null, searchCount: result.usage.searchCount,
        costUsd: cost.totalUsd, costJpy: cost.totalUsd * m.budget.fx_jpy_per_usd, error: null,
      };
      await storage.recordRun(run, { runId: run.id, text: result.text, citations: result.citations, request: result.request, raw: result.raw });
      summary.ok++;
      stats.ok++;
    } else {
      budget.settle(reserve, 0);
      const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      const run: RunRecord = {
        ...base, model: null, executedAt, status: "failed", attempts: outcome.attempts, latencyMs: Date.now() - started,
        inputTokens: null, outputTokens: null, reasoningTokens: null, searchCount: null, costUsd: 0, costJpy: 0,
        error: message.slice(0, 2000),
      };
      await storage.recordRun(run, null);
      summary.failed++;
      stats.failed++;
      log(`[失敗] ${job.engine} ${job.prompt.key} #${job.trialNo}: ${message.slice(0, 200)}`);
    }
    done++;
    if (done % 50 === 0) log(`[進捗] ${done}/${jobs.length} 完了 / 費用 $${summary.costUsd.toFixed(2)}`);
  };

  // エンジン枠を先に取ってから全体枠を取る（他エンジンの待ちで全体枠が埋まらないように）
  const settled = await Promise.allSettled(
    jobs.map((job) => engineSems.get(job.engine)!.run(() => globalSem.run(() => execute(job)))),
  );
  for (const s of settled) {
    if (s.status === "rejected") {
      // 保存自体に失敗したケース。生データが残らないため欠損として数える
      summary.storageErrors++;
      log(`[保存失敗] ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
    }
  }

  const attempted = summary.ok + summary.failed + summary.storageErrors;
  summary.missingRate = attempted ? (summary.failed + summary.storageErrors) / attempted : 0;
  summary.missingRateOk = summary.missingRate <= m.max_missing_rate;
  summary.costJpy = summary.costUsd * m.budget.fx_jpy_per_usd;
  summary.budget = budget.snapshot();
  await storage.finishMeasurement(measurementId, summary);
  return summary;
}

class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
