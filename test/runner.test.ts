import assert from "node:assert/strict";
import { test } from "node:test";
import { type AppConfig, type EngineName, loadConfig } from "../src/config.ts";
import { MockEngine } from "../src/engines/mock.ts";
import { type EngineClient, EngineHttpError } from "../src/engines/types.ts";
import type { SelectedPrompt } from "../src/plans.ts";
import type { EntitiesFile, Prompt } from "../src/questions/index.ts";
import { BudgetGuard, ClientBudgets } from "../src/runner/budget.ts";
import { withRetry } from "../src/runner/retry.ts";
import { BudgetExceededError, runMeasurement } from "../src/runner/run.ts";
import { MemoryStorage } from "../src/storage/memory.ts";

const base = loadConfig();
const noSleep = async () => {};
const quiet = () => {};
const entities: EntitiesFile = {
  clients: [
    { id: "std", name: "標準の顧客", plan: "standard" },
    { id: "try", name: "お試しの顧客", plan: "trial" },
  ],
  entities: [],
};

function withBudget(monthlyJpy: number): AppConfig {
  return { ...base, measurement: { ...base.measurement, budget: { ...base.measurement.budget, monthly_jpy: monthlyJpy } } };
}

function select(n: number, o: { priority?: Prompt["priority"]; trials?: number; clients?: string[]; engines?: EngineName[]; offset?: number } = {}): SelectedPrompt[] {
  const clients = o.clients ?? ["std"];
  return Array.from({ length: n }, (_, i) => {
    const k = i + (o.offset ?? 0);
    return {
      prompt: {
        key: `q${k}`, questionId: `idol-disc-${String(k).padStart(3, "0")}`, industry: "idol", category: "discovery",
        priority: o.priority ?? "normal", variant: 0, entityId: null, competitorId: null, clientIds: clients, text: `質問${k}`,
      },
      clientIds: clients,
      trials: o.trials ?? 1,
      clientTrials: Object.fromEntries(clients.map((c) => [c, o.trials ?? 1])),
      engineClients: Object.fromEntries((o.engines ?? ["openai", "claude"]).map((e) => [e, clients])),
    };
  });
}

const run = (over: Partial<Parameters<typeof runMeasurement>[0]> & { selection: SelectedPrompt[] }) =>
  runMeasurement({
    config: base, engines: [new MockEngine("openai"), new MockEngine("claude")], storage: new MemoryStorage(), entities,
    scope: "test", sleep: noSleep, log: quiet, ...over,
  });

test("全件を保存し、一時エラーはリトライで回収する", async () => {
  // 各質問の1回目だけ 503 を返すエンジン
  const inner = new MockEngine("openai");
  const seen = new Map<string, number>();
  const flaky: EngineClient = {
    name: "openai",
    model: inner.model,
    async ask(prompt, options) {
      const c = (seen.get(prompt) ?? 0) + 1;
      seen.set(prompt, c);
      if (c % 2 === 1) throw new EngineHttpError("openai", 503, "transient");
      return inner.ask(prompt, options);
    },
  };
  const storage = new MemoryStorage();
  const s = await run({ engines: [flaky, new MockEngine("claude")], storage, selection: select(15) });
  assert.equal(s.plannedCalls, 30);
  assert.equal(s.ok, 30);
  assert.equal(s.missingRate, 0);
  assert.equal(storage.runs.length, 30);
  assert.equal(storage.responses.size, 30);
  assert.ok(storage.runs.filter((r) => r.engine === "openai").every((r) => r.attempts === 2));
  assert.ok(storage.runs.every((r) => r.configHash === base.snapshotHash && r.model === `mock-${r.engine}`));
  assert.ok(storage.runs.every((r) => r.costAllocation.std === 1));
  assert.ok(s.costUsd > 0);
});

test("試行回数は質問ごと（プランの最大値）に従い、エンジンはプランに含まれるものだけ", async () => {
  const storage = new MemoryStorage();
  const s = await run({
    storage,
    selection: [...select(1, { trials: 3 }), ...select(1, { trials: 5, offset: 1, engines: ["claude"] })],
  });
  assert.equal(s.plannedCalls, 3 * 2 + 5 * 1);
  assert.equal(storage.runs.filter((r) => r.promptKey === "q1" && r.engine === "openai").length, 0);
});

test("最大3回失敗したら失敗として記録し、欠損率に数える", async () => {
  const storage = new MemoryStorage();
  const s = await run({ engines: [new MockEngine("openai", { failRate: 1 })], storage, selection: select(2, { engines: ["openai"] }) });
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
  await assert.rejects(run({ config: withBudget(100), storage, selection: select(50, { trials: 5 }) }), BudgetExceededError);
  assert.equal(storage.runs.length, 0);
});

test("予算100%超えで normal を止め、high は続行。止めた分は予算停止として記録", () => {
  const b = new BudgetGuard({ monthly_jpy: 155, fx_jpy_per_usd: 155, warn_ratio: 0.8, hard_stop_ratio: 1.1 }, 0.95, quiet); // 上限 $1
  assert.equal(b.tryReserve(0.1, "normal"), false); // 1.05 > 1.0
  assert.equal(b.tryReserve(0.1, "high"), true); // 1.05 <= 1.1
  b.settle(0.1, 0.1);
  assert.equal(b.tryReserve(0.1, "high"), false); // 1.15 > 1.1
});

test("全体予算で止まった試行も行として残す（欠損を明示）", async () => {
  const storage = new MemoryStorage();
  storage.baseMonthCostUsd = 1300 / 155; // 上限 ¥1,300 に対して使用済み ¥1,300
  const s = await run({
    config: withBudget(1300), engines: [new MockEngine("claude")], storage, force: true,
    selection: [...select(1, { priority: "high", engines: ["claude"] }), ...select(2, { offset: 1, engines: ["claude"] })],
  });
  assert.equal(s.ok, 1); // high のみ実行
  assert.equal(s.skippedBudget, 2);
  assert.equal(storage.runs.filter((r) => r.status === "skipped_budget").length, 2);
});

test("顧客の原価上限: 上限に達した顧客の分は止め、共有の質問は残りの顧客で按分する", async () => {
  const storage = new MemoryStorage();
  storage.baseMonthCostByClient = { try: 3000 / 155 }; // お試し顧客は上限 ¥3,000 に到達済み
  const s = await run({
    storage,
    engines: [new MockEngine("claude")],
    selection: [
      ...select(1, { clients: ["try"], engines: ["claude"] }), // お試し顧客専用 → 止まる
      ...select(1, { clients: ["std", "try"], engines: ["claude"], offset: 1 }), // 共有 → 標準顧客だけで負担
    ],
  });
  assert.equal(s.ok, 1);
  assert.equal(s.skippedBudget, 1);
  const shared = storage.runs.find((r) => r.promptKey === "q1")!;
  assert.deepEqual(shared.costAllocation, { std: 1 });
  assert.ok(storage.runs.find((r) => r.promptKey === "q0")!.error!.includes("顧客の原価上限"));
});

test("共有の質問の費用は顧客数で均等に按分する", async () => {
  const storage = new MemoryStorage();
  await run({ storage, engines: [new MockEngine("claude")], selection: select(1, { clients: ["std", "try"], engines: ["claude"] }) });
  const r = storage.runs[0];
  assert.deepEqual(r.costAllocation, { std: 0.5, try: 0.5 });
  const byClient = await storage.monthToDateCostUsdByClient(new Date());
  assert.ok(Math.abs(byClient.std - r.costUsd / 2) < 1e-12);
});

test("ClientBudgets: 按分額で上限判定し、予約を精算する", () => {
  const b = new ClientBudgets({ a: 1, b: 1 }, { a: 0.9 });
  assert.deepEqual(b.tryReserve(["a", "b"], 0.4), ["b"]); // a は 0.9+0.2>1 なので外れ、b が 0.4 を全額負担
  b.settle(["b"], 0.4, 0.3);
  assert.equal(b.tryReserve(["b"], 0.8), null); // 0.3+0.8 > 1
});

test("生データは上書きできない", async () => {
  const storage = new MemoryStorage();
  await run({ storage, engines: [new MockEngine("claude")], selection: select(1, { engines: ["claude"] }) });
  await assert.rejects(storage.recordRun({ ...storage.runs[0], id: "other" }, null));
});
