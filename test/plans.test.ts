import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { isDue, jstCalendar, selectPrompts } from "../src/plans.ts";
import { type EntitiesFile, expandPrompts, loadQuestions } from "../src/questions/index.ts";
import { buildPlan, estimatePlan } from "../src/runner/plan.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = loadConfig();
const cal = config.plans.calendar;
const questions = loadQuestions(`${root}questions`, config.factKeys);
const jst = (ymd: string) => new Date(`${ymd}T09:00:00+09:00`);

// アイドル業界にお試し・標準の2社、音楽業界にお試し1社
const file: EntitiesFile = {
  clients: [
    { id: "std", name: "標準", plan: "standard" },
    { id: "try", name: "お試し", plan: "trial" },
    { id: "mus", name: "音楽お試し", plan: "trial" },
  ],
  entities: [
    { id: "s1", client_id: "std", industry: "idol", role: "target", type: "group", official_name: "グループS", aliases: [], ambiguous: false, competitors: ["x1", "x2", "x3"] },
    { id: "t1", client_id: "try", industry: "idol", role: "target", type: "group", official_name: "グループT", aliases: [], ambiguous: false, competitors: ["x1", "x2", "x3"] },
    ...["x1", "x2", "x3"].map((id) => ({ id, client_id: "std", industry: "idol", role: "competitor" as const, type: "group" as const, official_name: id, aliases: [], ambiguous: false, competitors: [] })),
    { id: "m1", client_id: "mus", industry: "music", role: "target", type: "artist", official_name: "歌手M", aliases: [], ambiguous: false, competitors: [] },
  ],
};
const prompts = expandPrompts(questions, file, config.plans);

test("日本時間で計測日を判定する（2026-11-02 は月曜、11-05 は木曜）", () => {
  assert.equal(jstCalendar(new Date("2026-11-01T15:30:00Z")).ymd, "2026-11-02"); // UTC では日曜
  assert.equal(isDue("weekly", jst("2026-11-02"), cal), true);
  assert.equal(isDue("weekly", jst("2026-11-05"), cal), false);
  assert.equal(isDue("twice_weekly", jst("2026-11-05"), cal), true);
  assert.equal(isDue("monthly", jst("2026-12-01"), cal), true);
  assert.equal(isDue("monthly", jst("2026-12-02"), cal), false);
  assert.equal(isDue("none", jst("2026-11-02"), cal), false);
  // ISO 週: 2026-11-02 は第45週（奇数）、11-09 は第46週（偶数）
  assert.equal(isDue("biweekly", jst("2026-11-02"), cal), false);
  assert.equal(isDue("biweekly", jst("2026-11-09"), cal), true);
});

test("お試しプラン: trial タグの質問だけ・言い換えなし。発見の質問は同業界で共有", () => {
  const trialOwn = prompts.filter((p) => p.clientIds.includes("try"));
  assert.ok(trialOwn.every((p) => p.variant === 0));
  const trialIds = new Set(questions.filter((q) => q.plans.includes("trial")).map((q) => q.id));
  assert.ok(trialOwn.every((p) => trialIds.has(p.questionId)));
  assert.ok(!trialOwn.some((p) => p.questionId === "idol-ent-004")); // trial タグなし
  const disc = prompts.find((p) => p.key === "idol-disc-001|v0|-|-")!;
  assert.deepEqual(disc.clientIds.sort(), ["std", "try"]);
  const para = prompts.find((p) => p.key === "idol-disc-001|v1|-|-")!;
  assert.deepEqual(para.clientIds, ["std"]); // 言い換えは標準だけ
  assert.ok(trialOwn.length >= 10 && trialOwn.length <= 15);
});

test("定期実行: 月初の月曜は全員、普通の木曜は標準の重要質問だけ", () => {
  // 2026-06-01 は月曜かつ1日
  const both = selectPrompts(prompts, file, config.plans, { kind: "scheduled", now: jst("2026-06-01") });
  assert.ok(both.some((s) => s.clientIds.includes("try")));
  const shared = both.find((s) => s.prompt.key === "idol-disc-001|v0|-|-")!;
  assert.equal(shared.trials, 5); // 標準とお試しの最大
  // 2026-11-05 は木曜
  const thu = selectPrompts(prompts, file, config.plans, { kind: "scheduled", now: jst("2026-11-05") });
  assert.ok(thu.length > 0);
  assert.ok(thu.every((s) => s.prompt.priority === "high" && s.clientIds.join() === "std"));
  // 2026-11-03 は火曜: 誰も計測しない
  assert.equal(selectPrompts(prompts, file, config.plans, { kind: "scheduled", now: jst("2026-11-03") }).length, 0);
});

test("お試しプランの月額原価の見積もりが上限内に収まる", () => {
  const sel = selectPrompts(prompts, file, config.plans, { kind: "full" }, { clients: ["mus"] });
  const est = estimatePlan(buildPlan(sel), config.engines);
  const jpy = est.byClient.mus * config.measurement.budget.fx_jpy_per_usd;
  assert.ok(jpy < config.plans.plans.trial.monthly_cost_cap_jpy, `お試し1回の見積 ¥${Math.round(jpy)}`);
});

test("--clients で顧客を絞ると、共有の質問もその顧客分だけになる", () => {
  const sel = selectPrompts(prompts, file, config.plans, { kind: "full" }, { clients: ["try"] });
  assert.ok(sel.every((s) => s.clientIds.join() === "try" && s.trials === 3));
});

test("共有の質問で、プランの試行回数を超えた回はその顧客に按分しない", () => {
  const sel = selectPrompts(prompts, file, config.plans, { kind: "full" }).filter((s) => s.prompt.key === "idol-disc-001|v0|-|-");
  const jobs = buildPlan(sel).filter((j) => j.engine === "claude");
  assert.deepEqual(jobs.map((j) => j.clientIds.sort().join("+")), ["std+try", "std+try", "std+try", "std", "std"]);
});
