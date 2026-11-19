import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyCitations, citationDomain, classifySource } from "../src/analysis/citations.ts";
import { type ClaimJudge, type JudgeInput, factsForJudge, sanitizeClaims } from "../src/analysis/claims.ts";
import { analyzeRuns, planAnalysis } from "../src/analysis/index.ts";
import { detectMentions } from "../src/analysis/mentions.ts";
import { loadConfig } from "../src/config.ts";
import type { FactRecord } from "../src/facts.ts";
import type { EntitiesFile, Entity, Question } from "../src/questions/index.ts";
import { MemoryStorage } from "../src/storage/memory.ts";
import type { RunRecord } from "../src/storage/types.ts";

const config = loadConfig();
const lists = config.analysis.source_domains;

const ent = (id: string, name: string, o: Partial<Entity> = {}): Entity => ({
  id, client_id: "c1", industry: "idol", role: "competitor", type: "group", official_name: name, aliases: [], ambiguous: false,
  competitors: [], contexts: {}, ...o,
});

test("言及: 表記ゆれ（全角・カタカナ/ひらがな）を吸収し、出てきた順に rank を付ける", () => {
  const es = [ent("a", "ほしぞらガールズ"), ent("b", "ＳＫＹ９", { aliases: ["スカイナイン"] })];
  const got = detectMentions("おすすめは sky9 と、ホシゾラガールズ です。", es);
  assert.deepEqual(got, [{ entityId: "b", rank: 1 }, { entityId: "a", rank: 2 }]);
});

test("言及: 別の対象の長い名前の一部として出てきただけのものは数えない", () => {
  const es = [ent("short", "サンプル"), ent("long", "サンプルズ")];
  assert.deepEqual(detectMentions("サンプルズのライブ", es), [{ entityId: "long", rank: 1 }]);
  assert.deepEqual(detectMentions("サンプルズとサンプル", es).map((m) => m.entityId).sort(), ["long", "short"]);
});

test("言及: 一般名詞と同じ名前は、質問の主題でない限り短い別名では拾わない", () => {
  const es = [ent("amb", "ハル", { ambiguous: true, aliases: ["ハル（アイドル）"] })];
  assert.deepEqual(detectMentions("春になるとハルの季節", es), []);
  assert.deepEqual(detectMentions("ハルの新曲", es, "amb"), [{ entityId: "amb", rank: 1 }]);
});

test("引用元: Gemini のリダイレクトURLは title のドメインを使い、公式ドメインを最優先する", () => {
  assert.equal(citationDomain({ url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "natalie.mu" }), "natalie.mu");
  assert.equal(citationDomain({ url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "ナタリー" }), null);
  assert.equal(citationDomain({ url: "https://www.Oricon.co.jp/news/1" }), "oricon.co.jp");
  assert.equal(classifySource("ja.wikipedia.org", [], lists), "wiki");
  assert.equal(classifySource("x.com", ["x.com"], lists), "official");
  assert.equal(classifySource("news.example.com", ["example.com"], lists), "official");
  assert.equal(classifySource("notexample.com", ["example.com"], lists), "other");
  const out = classifyCitations([{ url: "https://natalie.mu/a" }, { url: "https://natalie.mu/a" }, { url: "not a url" }], [], lists);
  assert.deepEqual(out, [{ url: "https://natalie.mu/a", domain: "natalie.mu", sourceType: "media" }]);
});

const fact = (key: string, value: unknown, o: Partial<FactRecord> = {}): FactRecord => ({
  entityId: "t1", key, value, validFrom: null, validTo: null, sourceUrl: "https://example.com", sourceType: "public", publicFrom: null,
  checkedAt: "2026-11-01", note: null, importBatch: "b", createdAt: "2026-11-01T00:00:00Z", ...o,
});
const defs = config.factKeys.idol;

test("判定用の正解データ: 回答日の正解と、それ以前に終わった値（履歴）。公表日前の情報は使わない", () => {
  const facts = [
    fact("current_members", ["A", "B", "C"], { validFrom: "2023-01-01", validTo: "2026-03-31" }),
    fact("current_members", ["A", "B"], { validFrom: "2026-04-01" }),
    fact("agency", "新事務所", { validFrom: "2026-12-01", publicFrom: "2026-11-25" }),
    fact("agency", "旧事務所", { validFrom: "2020-01-01", validTo: "2026-11-30" }),
  ];
  const got = factsForJudge(facts, "t1", ["current_members", "agency", "formed_on"], defs, "2026-11-10");
  assert.equal(got.length, 2);
  const members = got.find((f) => f.key === "current_members")!;
  assert.equal(members.current, "A・B");
  assert.deepEqual(members.past.map((p) => p.value), ["A・B・C"]);
  const agency = got.find((f) => f.key === "agency")!;
  assert.equal(agency.current, "旧事務所");
  assert.equal(agency.past.length, 0);
});

const judgeInput = (answer: string): JudgeInput => ({
  entityName: "グループT", aliases: [], date: "2026-11-10", question: "グループTについて教えて", answer,
  facts: [
    { key: "current_members", label: "現メンバー", type: "list", current: "A、B", past: [{ value: "A、B、C", validFrom: null, validTo: "2026-03-31" }] },
    { key: "agency", label: "所属事務所", type: "string", current: "旧事務所", past: [] },
  ],
});

test("判定の検証: 回答に無い引用は捨て、確信度が低いものは照合不能、履歴が無い「古い」は「誤り」にする", () => {
  const input = judgeInput("グループTは A・B・C の3人組で、新事務所に所属しています。");
  const raw = {
    claims: [
      { fact_key: "current_members", statement: "メンバーは3人（Cを含む）", normalized: "members-3", verdict: "outdated", confidence: 0.9, evidence: "A・B・C の3人組" },
      { fact_key: "agency", statement: "所属は新事務所", normalized: "agency-new", verdict: "outdated", confidence: 0.8, evidence: "新事務所に所属" },
      { fact_key: "agency", statement: "所属は旧事務所", normalized: "agency-old", verdict: "correct", confidence: 0.9, evidence: "旧事務所に所属しています" },
      { fact_key: "formed_on", statement: "結成は2020年", normalized: "x", verdict: "incorrect", confidence: 0.9, evidence: "3人組" },
      { fact_key: "current_members", statement: "メンバーはA", normalized: "m-a", verdict: "correct", confidence: 0.3, evidence: "グループTは A" },
    ],
  };
  const got = sanitizeClaims(raw, input, 0.6);
  assert.deepEqual(got.map((c) => [c.factKey, c.verdict]), [["current_members", "outdated"], ["agency", "incorrect"], ["current_members", "unverifiable"]]);
});

// ---- 解析全体 ----

const entities: EntitiesFile = {
  clients: [{ id: "c1", name: "顧客", plan: "basic" }, { id: "c2", name: "顧客2", plan: "basic" }],
  entities: [
    ent("t1", "グループT", { role: "target", competitors: ["x1"], official_domains: ["group-t.example.jp"] }),
    ent("x1", "グループX"),
  ],
};
const questions: Question[] = [
  { id: "idol-ent-001", industry: "idol", category: "entity", template: "{entity}について教えて", variables: ["entity"], fact_keys: ["current_members", "agency"], priority: "normal", paraphrases: [], plans: [], contexts: {} },
  { id: "idol-disc-001", industry: "idol", category: "discovery", template: "おすすめのアイドルは？", variables: [], fact_keys: [], priority: "normal", paraphrases: [], plans: [], contexts: {} },
];
const facts = [fact("current_members", ["A", "B"]), fact("agency", "旧事務所")];

const run = (id: string, o: Partial<RunRecord>): RunRecord => ({
  id, measurementId: "m1", promptKey: id, questionId: "idol-ent-001", entityId: "t1", competitorId: null, variant: 0, context: {},
  promptText: "グループTについて教えて", engine: "openai", model: "x", trialNo: 1, executedAt: "2026-11-10T03:00:00Z", status: "ok", attempts: 1,
  latencyMs: 1, inputTokens: 1, outputTokens: 1, reasoningTokens: null, searchCount: 1, costUsd: 0.03, costJpy: 4.65, costAllocation: { c1: 1 },
  error: null, configHash: "h", ...o,
});

const fakeJudge = (fail = new Set<string>()): ClaimJudge & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    async judge(input) {
      calls.push(input.answer);
      if ([...fail].some((f) => input.answer.includes(f))) throw new Error("bad request");
      const claims = input.answer.includes("旧事務所")
        ? [{ factKey: "agency", statement: "所属は旧事務所", normalized: "agency-old", verdict: "correct" as const, confidence: 0.9, evidence: "旧事務所" }]
        : [];
      return { claims, model: "judge-x", inputTokens: 2000, outputTokens: 200, costUsd: 0.001 };
    },
  };
};

test("解析: 主題が回答に出てきて正解データがあるときだけ判定し、言及・引用元はすべての回答で記録する", async () => {
  const targets = [
    { run: run("r1", {}), response: { runId: "r1", text: "グループTは旧事務所所属。グループXとも共演。", citations: [{ url: "https://group-t.example.jp/profile" }], request: null, raw: null } },
    { run: run("r2", {}), response: { runId: "r2", text: "その名前のグループは見つかりませんでした。", citations: [], request: null, raw: null } },
    {
      run: run("r3", { questionId: "idol-disc-001", entityId: null, promptText: "おすすめのアイドルは？", costAllocation: { c1: 0.5, c2: 0.5 } }),
      response: { runId: "r3", text: "グループXとグループTがおすすめ", citations: [{ url: "https://ja.wikipedia.org/wiki/X" }], request: null, raw: null },
    },
  ];
  const judge = fakeJudge();
  const res = await analyzeRuns(targets, { config, entities, facts, questions, judge, measurementId: "m1" });
  assert.equal(judge.calls.length, 1); // r2 は主題が出てこない、r3 は発見の質問なので判定しない
  assert.deepEqual(res.mentions.map((m) => `${m.runId}:${m.entityId}:${m.rank}`), ["r1:t1:1", "r1:x1:2", "r3:x1:1", "r3:t1:2"]);
  assert.deepEqual(res.citations.map((c) => c.sourceType), ["official", "wiki"]);
  assert.deepEqual(res.claims.map((c) => [c.runId, c.factKey, c.verdict]), [["r1", "agency", "correct"]]);
  assert.deepEqual(res.batch.runIds, ["r1", "r2", "r3"]);
  assert.equal(res.batch.costUsd, 0.001);
  assert.deepEqual(res.batch.costAllocation, { c1: 0.001 });
});

test("解析: 判定に失敗した回答は解析済みにせず次回やり直す。解析の費用は予算の集計に含まれる", async () => {
  const st = new MemoryStorage();
  await st.createMeasurement({ id: "m1", scope: "t", startedAt: "2026-11-10T00:00:00Z", configHash: "h", plannedCalls: 2, estimatedUsd: 0 });
  await st.recordRun(run("r1", {}), { runId: "r1", text: "グループTは旧事務所", citations: [], request: null, raw: null });
  await st.recordRun(run("r2", { promptKey: "r2" }), { runId: "r2", text: "グループTは不明な事務所", citations: [], request: null, raw: null });
  await st.recordRun(run("r3", { promptKey: "r3", status: "failed", costUsd: 0 }), null);
  const targets = await st.listUnanalyzed("b1");
  assert.deepEqual(targets.map((t) => t.run.id), ["r1", "r2"]);
  const res = await analyzeRuns(targets, {
    config: { ...config, analysis: { ...config.analysis, version: "b1", llm: { ...config.analysis.llm, max_attempts: 1 } } },
    entities, facts, questions, judge: fakeJudge(new Set(["不明"])), sleep: async () => {},
  });
  assert.deepEqual(res.failedRunIds, ["r2"]);
  assert.ok(res.mentions.every((m) => m.runId === "r1"));
  await st.saveAnalysis(res);
  assert.deepEqual((await st.listUnanalyzed("b1")).map((t) => t.run.id), ["r2"]);
  assert.deepEqual((await st.listUnanalyzed("b2")).map((t) => t.run.id), ["r1", "r2"]);
  const now = new Date("2026-11-20T00:00:00Z");
  const runCost = 0.03 * 2;
  assert.ok(Math.abs((await st.monthToDateCostUsd(now)) - (runCost + res.batch.costUsd)) < 1e-9);
  assert.ok(Math.abs((await st.monthToDateCostUsdByClient(now)).c1 - (runCost + res.batch.costUsd)) < 1e-9);
});

test("解析の計画: プランの fact_keys に無い項目は判定しない（Lite は項目を絞る）", () => {
  const lite: EntitiesFile = { ...entities, clients: [{ id: "c1", name: "顧客", plan: "lite" }] };
  const target = { run: run("r1", {}), response: { runId: "r1", text: "グループTは旧事務所所属", citations: [], request: null, raw: null } };
  const [p] = planAnalysis([target], { config, entities: lite, facts, questions });
  assert.deepEqual(p.judgeInput?.input.facts.map((f) => f.key), ["current_members", "agency"].filter((k) => (config.plans.plans.lite.fact_keys as Record<string, string[]>).idol.includes(k)));
});
