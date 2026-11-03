import assert from "node:assert/strict";
import { test } from "node:test";
import { type AppConfig, loadConfig } from "../src/config.ts";
import { MockEngine } from "../src/engines/mock.ts";
import { type EngineClient, EngineHttpError } from "../src/engines/types.ts";
import type { Prompt } from "../src/questions/index.ts";
import { BudgetGuard } from "../src/runner/budget.ts";
import { withRetry } from "../src/runner/retry.ts";
import { BudgetExceededError, runMeasurement } from "../src/runner/run.ts";
import { MemoryStorage } from "../src/storage/memory.ts";

const base = loadConfig();
const noSleep = async () => {};
const quiet = () => {};

function withBudget(monthlyJpy: number): AppConfig {
  return { ...base, measurement: { ...base.measurement, budget: { ...base.measurement.budget, monthly_jpy: monthlyJpy } } };
}

function prompts(n: number, priority: Prompt["priority"] = "normal"): Prompt[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `q${i}`, questionId: `idol-disc-${String(i).padStart(3, "0")}`, industry: "idol", category: "discovery",
    priority, variant: 0, entityId: null, competitorId: null, text: `質問${i}`,
  }));
}

test("全件を保存し、一時エラーはリトライで回収する", async () => {
  // 各試行の1回目だけ 503 を返すエンジン
  const inner = new MockEngine("openai");
  const seen = new Map<string, number>();
  const flaky: EngineClient = {
    name: "openai",
    model: inner.model,
    async ask(prompt, options) {
      const k = prompt;
      const c = (seen.get(k) ?? 0) + 1;
      seen.set(k, c);
      if (c % 2 === 1) throw new EngineHttpError("openai", 503, "transient");
      return inner.ask(prompt, options);
    },
  };
  const storage = new MemoryStorage();
  const s = await runMeasurement({
    config: base, engines: [flaky, new MockEngine("claude")], storage, prompts: prompts(15), scope: "full", trials: 1,
    sleep: noSleep, log: quiet,
  });
  assert.equal(s.plannedCalls, 30);
  assert.equal(s.ok, 30);
  assert.equal(s.missingRate, 0);
  assert.equal(storage.runs.length, 30);
  assert.equal(storage.responses.size, 30);
  assert.ok(storage.runs.filter((r) => r.engine === "openai").every((r) => r.attempts === 2));
  assert.ok(storage.runs.every((r) => r.configHash === base.snapshotHash && r.model === `mock-${r.engine}`));
  assert.ok(s.costUsd > 0);
});

test("最大3回失敗したら失敗として記録し、欠損率に数える", async () => {
  const storage = new MemoryStorage();
  const s = await runMeasurement({
    config: base, engines: [new MockEngine("gemini", { failRate: 1 })], storage, prompts: prompts(2), scope: "full", trials: 1,
    sleep: noSleep, log: quiet,
  });
  assert.equal(s.failed, 2);
  assert.equal(s.missingRate, 1);
  assert.equal(s.missingRateOk, false);
  assert.ok(storage.runs.every((r) => r.status === "failed" && r.attempts === 3 && r.costUsd === 0 && r.error));
});

test("再試行しないエラー（400など）は1回で諦める", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw new EngineHttpError("x", 400, "bad request"); }, { maxAttempts: 3, baseDelayMs: 0, sleep: noSleep }),
  );
  assert.equal(calls, 1);
});

test("見積額が予算の上限を超える計測は開始しない", async () => {
  const storage = new MemoryStorage();
  await assert.rejects(
    runMeasurement({ config: withBudget(100), engines: [new MockEngine("claude")], storage, prompts: prompts(50), scope: "full", trials: 5, log: quiet }),
    BudgetExceededError,
  );
  assert.equal(storage.runs.length, 0);
});

test("予算100%超えで normal を止め、high は続行。止めた分は予算停止として記録", () => {
  const b = new BudgetGuard({ monthly_jpy: 155, fx_jpy_per_usd: 155, warn_ratio: 0.8, hard_stop_ratio: 1.1 }, 0.95, quiet); // 上限 $1
  assert.equal(b.tryReserve(0.1, "normal"), false); // 1.05 > 1.0
  assert.equal(b.tryReserve(0.1, "high"), true); // 1.05 <= 1.1
  b.settle(0.1, 0.1);
  assert.equal(b.tryReserve(0.1, "high"), false); // 1.15 > 1.1
});

test("予算停止になった試行も行として残す（欠損を明示）", async () => {
  const storage = new MemoryStorage();
  storage.baseMonthCostUsd = 1300 / 155; // 上限 ¥1,300 に対して使用済み ¥1,300
  const s = await runMeasurement({
    config: withBudget(1300), engines: [new MockEngine("perplexity")], storage,
    prompts: [...prompts(1, "high"), ...prompts(2)].map((p, i) => ({ ...p, key: `k${i}` })), scope: "full", trials: 1,
    force: true, sleep: noSleep, log: quiet,
  });
  assert.equal(s.ok, 1); // high のみ実行
  assert.equal(s.skippedBudget, 2);
  assert.equal(storage.runs.filter((r) => r.status === "skipped_budget").length, 2);
});

test("priority スコープは high の質問だけを計測する", async () => {
  const storage = new MemoryStorage();
  const s = await runMeasurement({
    config: base, engines: [new MockEngine("claude")], storage,
    prompts: [...prompts(2, "high"), ...prompts(3)].map((p, i) => ({ ...p, key: `k${i}` })), scope: "priority", trials: 2, log: quiet,
  });
  assert.equal(s.plannedCalls, 4);
});

test("生データは上書きできない", async () => {
  const storage = new MemoryStorage();
  await runMeasurement({ config: base, engines: [new MockEngine("claude")], storage, prompts: prompts(1), scope: "full", trials: 1, log: quiet });
  await assert.rejects(storage.recordRun({ ...storage.runs[0], id: "other" }, null));
});
