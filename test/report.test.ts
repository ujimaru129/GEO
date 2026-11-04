import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, formatFactValue, publishedVerdict } from "../src/report/compute.ts";
import { buildDemoWorld } from "../src/report/demo.ts";
import { jstWeekStart, metric, wilson } from "../src/report/stats.ts";
import type { RClaim, ReportRows } from "../src/report/types.ts";

test("ウィルソン法: 既知の値と一致し、0件・全件でも 0〜1 に収まる", () => {
  const w = wilson(30, 100);
  assert.ok(Math.abs(w.low - 0.2189) < 0.001 && Math.abs(w.high - 0.3958) < 0.001);
  assert.deepEqual(wilson(0, 0), { low: 0, high: 0 });
  assert.ok(wilson(0, 10).low === 0 && wilson(10, 10).high === 1);
});

test("前回の値が今回の95%区間に入っていれば「変化なし」", () => {
  assert.equal(metric(30, 100, { successes: 27, n: 100 }).change, "flat");
  assert.equal(metric(60, 100, { successes: 27, n: 100 }).change, "up");
  assert.equal(metric(10, 100, { successes: 27, n: 100 }).change, "down");
  assert.equal(metric(10, 100, null).change, null);
});

test("社内確認前の「誤り」は顧客に出さない。確認後は確認結果を使う", () => {
  const c = { verdict: "incorrect" } as RClaim;
  assert.equal(publishedVerdict(c, undefined), null);
  assert.equal(publishedVerdict(c, { claimId: "1", decision: "outdated", reviewer: "a", reviewerName: "A", reviewedAt: "", note: null }), "outdated");
  assert.equal(publishedVerdict({ verdict: "outdated" } as RClaim, undefined), "outdated");
});

test("週は日本時間の月曜始まり", () => {
  assert.equal(jstWeekStart("2026-11-01T15:30:00Z"), "2026-11-02"); // 11/2(月) 0:30 JST
  assert.equal(jstWeekStart("2026-11-01T14:59:00Z"), "2026-10-26"); // 11/1(日) 23:59 JST
});

test("正解データの表示形式", () => {
  assert.equal(formatFactValue(["A", "B"]), "A・B");
  assert.equal(formatFactValue({ title: "曲", date: "2026-10-15" }), "「曲」2026/10/15");
  assert.equal(formatFactValue("2023-01-15"), "2023/01/15");
  assert.equal(formatFactValue("active"), "サービス中");
});

function rowsFor(clientId: string): ReportRows {
  const w = buildDemoWorld();
  const ents = w.entities.entities.filter((e) => e.client_id === clientId);
  const t = ents.find((e) => e.role === "target")!;
  const runs = w.runs.filter((r) => r.clientIds.includes(clientId));
  const ids = new Set(runs.map((r) => r.id));
  return {
    client: { id: clientId, name: "x", plan: "pro", planLabel: "Pro", industry: t.industry, industryLabel: "アイドル", subject: "このグループ", noun: "グループ", counter: "組", report: "full", humanSupport: true, trials: 5 },
    target: { id: t.id, name: t.official_name, role: "target" },
    competitors: ents.filter((e) => e.role === "competitor").map((e) => ({ id: e.id, name: e.official_name, role: "competitor" as const })),
    runs, mentions: w.mentions.filter((m) => ids.has(m.runId)), claims: w.claims.filter((c) => ids.has(c.runId)), reviews: w.reviews,
    citations: w.citations.filter((c) => ids.has(c.runId)), facts: w.facts, factLabels: {}, advice: w.advice.filter((a) => a.clientId === clientId),
    requests: [], submissions: [],
  };
}

test("レポート: 誤情報は確認済みの「誤り」と「古い」だけ、正解は判定時点の正解データ", () => {
  const rows = rowsFor("demo-idol");
  const v = buildReport(rows);
  const agency = v.misinfo.find((m) => m.factKey === "agency")!;
  // 最新週の ChatGPT の誤りのうち、確認済みは1件だけ
  assert.equal(agency.latestCount, 1);
  assert.ok(agency.review);
  assert.equal(agency.truth, "サンプルプロダクション");
  const formed = v.misinfo.find((m) => m.factKey === "formed_on")!;
  assert.equal(formed.ongoing, false); // 解消済み
  const release = v.misinfo.find((m) => m.factKey === "latest_release")!;
  assert.equal(release.truth, "「サンプルシングル」2026/10/15");
  assert.equal(v.trend.length, 6);
  assert.ok(v.share.value > 0 && v.share.value < 1);
  assert.ok(v.advice && v.advice.status === "approved"); // 下書きは出さない
});

test("レポート: 確認待ちの「誤り」は正確率の分母からも外す", () => {
  const rows = rowsFor("demo-idol");
  const before = buildReport(rows).accuracy.n;
  const pending = rows.claims.filter((c) => c.verdict === "incorrect" && !rows.reviews.some((r) => r.claimId === c.id));
  assert.ok(pending.length > 0);
  const reviewed = { ...rows, reviews: [...rows.reviews, ...pending.map((c) => ({ claimId: c.id, decision: "incorrect" as const, reviewer: "a", reviewerName: "A", reviewedAt: "2026-11-03T00:00:00Z", note: null }))] };
  assert.equal(buildReport(reviewed).accuracy.n, before + pending.length);
});

test("条件別: 条件付きの質問は全体の数字に混ぜず、条件の組み合わせ・条件ごとに直近の観測週で集計する", () => {
  const rows = rowsFor("demo-idol");
  const v = buildReport(rows);
  const noCtx = buildReport({ ...rows, runs: rows.runs.filter((r) => Object.keys(r.context).length === 0) });
  assert.equal(v.share.value, noCtx.share.value); // 全体の数字は変わらない
  assert.equal(noCtx.contexts.groups.length, 0);
  const keys = v.contexts.groups.map((g) => g.key);
  assert.deepEqual(new Set(keys), new Set(["region=渋谷", "region=新宿", "region=大阪", "occasion=ハロウィン,region=渋谷"]));
  const halloween = v.contexts.groups.find((g) => g.key.startsWith("occasion"))!;
  assert.equal(halloween.weekStart, "2026-10-26"); // その時期だけ計測した条件は、最後に観測した週
  assert.equal(halloween.appearance.change, null); // 前回の観測がない
  const shibuya = v.contexts.groups.find((g) => g.key === "region=渋谷")!;
  assert.equal(shibuya.weekStart, "2026-11-02");
  assert.equal(shibuya.appearance.n, 20);
  const region = v.contexts.dimensions.find((d) => d.variable === "region")!;
  assert.equal(region.label, "地域");
  assert.equal(region.values[0].value, "渋谷");
  assert.equal(region.values.at(-1)!.value, "大阪");
  assert.ok(region.values[0].appearance.value > region.values.at(-1)!.appearance.value);
});
