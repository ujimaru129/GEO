import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  type FactRequest,
  answerUnknown,
  approveSubmission,
  createFactRequest,
  prepareStaffFact,
  rejectSubmission,
  submitByClient,
} from "../src/app/fact-requests.ts";
import { generateReportToken, hashReportToken, isWellFormedToken, tokenMatches } from "../src/app/report-links.ts";
import { loadConfig } from "../src/config.ts";
import { type FactContext, type FactRecord, currentFacts, factAt } from "../src/facts.ts";
import { loadEntities } from "../src/questions/index.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = loadConfig();
const ctx: FactContext = {
  entities: loadEntities(`${root}data/entities.yaml`, config.plans),
  factKeys: config.factKeys,
  plans: config.plans,
  now: new Date("2026-11-03T03:00:00Z"),
};
const STAFF = "yamamoto@example.com";

function openRequest(key = "current_members"): FactRequest {
  const r = createFactRequest(ctx, [], { clientId: "self", entityId: "idol-t1", key, reason: "公式サイトとSNSで人数が食い違っています", staffEmail: STAFF });
  assert.ok(r.ok);
  return r.value;
}

test("専用URLのトークン: 推測できない長さ、DB にはハッシュだけ", () => {
  const { token, tokenHash } = generateReportToken();
  assert.ok(isWellFormedToken(token));
  assert.equal(tokenHash, hashReportToken(token));
  assert.ok(tokenMatches(token, tokenHash));
  assert.ok(!tokenMatches(generateReportToken().token, tokenHash));
  assert.ok(!isWellFormedToken("short"));
  assert.notEqual(generateReportToken().token, token);
});

test("記入依頼: 競合・他社の対象・未知の項目・重複は作れない", () => {
  const req = openRequest();
  assert.ok(!createFactRequest(ctx, [req], { clientId: "self", entityId: "idol-t1", key: "current_members", reason: "x", staffEmail: STAFF }).ok);
  assert.ok(!createFactRequest(ctx, [], { clientId: "self", entityId: "idol-c1", key: "agency", reason: "x", staffEmail: STAFF }).ok);
  assert.ok(!createFactRequest(ctx, [], { clientId: "other", entityId: "idol-t1", key: "agency", reason: "x", staffEmail: STAFF }).ok);
  assert.ok(!createFactRequest(ctx, [], { clientId: "self", entityId: "idol-t1", key: "nope", reason: "x", staffEmail: STAFF }).ok);
  assert.ok(!createFactRequest(ctx, [], { clientId: "self", entityId: "idol-t1", key: "agency", reason: " ", staffEmail: STAFF }).ok);
});

test("顧客の記入 → 社内承認で正解データになる。出典URLなしは「顧客の申告」として記録", () => {
  const req = openRequest();
  const sub = submitByClient(ctx, req, "self", { value: "山田花子|佐藤美咲|鈴木愛|高橋結衣", validFrom: "2025-04-01", note: "公式発表済み" });
  assert.ok(sub.ok);
  assert.equal(sub.value.request.status, "submitted");
  assert.equal(sub.value.submission.input.sourceType, "client_provided");
  const ap = approveSubmission(ctx, sub.value.submission, sub.value.request, [], STAFF);
  assert.ok(ap.ok);
  assert.equal(ap.value.facts.length, 1);
  assert.deepEqual(ap.value.facts[0].value, ["山田花子", "佐藤美咲", "鈴木愛", "高橋結衣"]);
  assert.equal(ap.value.facts[0].sourceType, "client_provided");
  assert.equal(ap.value.facts[0].sourceUrl, null);
  assert.equal(ap.value.submission.reviewedBy, STAFF);
  assert.equal(ap.value.request!.status, "answered");
  assert.ok(!approveSubmission(ctx, ap.value.submission, null, [], STAFF).ok); // 二重承認は不可
});

test("顧客の入力ミスはその場で返す。他社の依頼や受付済みの依頼には記入できない", () => {
  const req = openRequest("formed_on");
  const bad = submitByClient(ctx, req, "self", { value: "2023/1/15" });
  assert.ok(!bad.ok && bad.errors[0].includes("YYYY-MM-DD"));
  assert.ok(!submitByClient(ctx, req, "other", { value: "2023-01-15" }).ok);
  assert.ok(!submitByClient(ctx, { ...req, status: "submitted" }, "self", { value: "2023-01-15" }).ok);
});

test("差し戻すと依頼は記入待ちに戻り、理由が残る。理由なしの差し戻しは不可", () => {
  const req = openRequest();
  const sub = submitByClient(ctx, req, "self", { value: "A|B" });
  assert.ok(sub.ok);
  assert.ok(!rejectSubmission(ctx, sub.value.submission, sub.value.request, STAFF, "").ok);
  const rj = rejectSubmission(ctx, sub.value.submission, sub.value.request, STAFF, "いつからの体制か日付を入れてください");
  assert.ok(rj.ok);
  assert.equal(rj.value.request!.status, "open");
  assert.equal(rj.value.submission.reviewNote, "いつからの体制か日付を入れてください");
});

test("顧客も分からない項目は unknown で閉じる", () => {
  const r = answerUnknown(ctx, openRequest("upcoming_live"), "self");
  assert.ok(r.ok);
  assert.equal(r.value.status, "unknown");
});

test("承認時に古い値を閉じられる（卒業・移籍）。閉じないと期間の重なりでエラー", () => {
  const staff = prepareStaffFact(ctx, { entityId: "idol-t1", key: "agency", value: "旧事務所", validFrom: "2023-01-15", sourceUrl: "https://a.example", checkedAt: "2026-10-01" }, [], STAFF);
  assert.ok(staff.ok);
  const existing: FactRecord[] = [{ ...staff.value, createdAt: "2026-10-01T00:00:00.000Z" }];
  const req = openRequest("agency");
  const sub = submitByClient(ctx, req, "self", { value: "新事務所", validFrom: "2026-11-01", sourceUrl: "https://b.example/news" });
  assert.ok(sub.ok);
  assert.ok(!approveSubmission(ctx, sub.value.submission, sub.value.request, existing, STAFF).ok);
  const ap = approveSubmission(ctx, sub.value.submission, sub.value.request, existing, STAFF, { closePrevious: true });
  assert.ok(ap.ok);
  const all = [...existing, ...ap.value.facts];
  assert.equal(currentFacts(all).find((f) => f.value === "旧事務所")!.validTo, "2026-10-31");
  assert.equal(factAt(all, "idol-t1", "agency", "2026-06-01")!.value, "旧事務所");
  assert.equal(factAt(all, "idol-t1", "agency", "2026-11-02")!.value, "新事務所");
});

test("未発表の情報: 公表日より前の AI の回答には判定に使わない", () => {
  const req = openRequest("latest_release");
  const sub = submitByClient(ctx, req, "self", { value: "次のシングル|2026-12-10", validFrom: "2026-12-10", publicFrom: "2026-11-20" });
  assert.ok(sub.ok);
  const ap = approveSubmission(ctx, sub.value.submission, sub.value.request, [], STAFF);
  assert.ok(ap.ok);
  assert.ok(ap.warnings.some((w) => w.includes("公表日")));
  const facts = ap.value.facts;
  assert.equal(factAt(facts, "idol-t1", "latest_release", "2026-12-15")?.value && true, true);
  // 有効期間内でも、公表前に計測した回答には使わない
  const early = [{ ...facts[0], validFrom: "2026-11-01" }];
  assert.equal(factAt(early, "idol-t1", "latest_release", "2026-11-10"), undefined);
  assert.ok(factAt(early, "idol-t1", "latest_release", "2026-11-25"));
});
