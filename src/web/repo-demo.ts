// デモ用の Repo。架空の3社のデータをメモリ上に持つ（サーバーを再起動すると操作は元に戻る）
import type { AppConfig } from "../config.ts";
import { type FactContext, type FactInput, currentFacts } from "../facts.ts";
import { formatFactValue, latestReviews } from "../report/compute.ts";
import { type DemoWorld, buildDemoWorld } from "../report/demo.ts";
import { jstDate } from "../report/stats.ts";
import type { ReportRows, Verdict } from "../report/types.ts";
import { generateReportToken } from "../workflow/report-links.ts";
import {
  answerUnknown,
  approveSubmission,
  createFactRequest,
  prepareStaffFact,
  rejectSubmission,
  submitByClient,
} from "../workflow/fact-requests.ts";
import { dedupeSources, factLabelsFor, nextRunDate, reportClient } from "./common.ts";
import type { ActionResult, ClientDetail, ClientOverview, FactsOverview, Repo, ReviewItem, RunsOverview, Staff } from "./repo.ts";

/** デモの「今日」。計測データ（〜11/2週）に合わせて固定する */
const DEMO_NOW = new Date("2026-11-04T03:00:00Z");

export class DemoRepo implements Repo {
  readonly mode = "demo" as const;
  private readonly w: DemoWorld;
  private readonly config: AppConfig;
  private readonly linkCreatedAt = new Map<string, string>();

  constructor(config: AppConfig) {
    this.config = config;
    this.w = buildDemoWorld();
    for (const c of this.w.entities.clients) this.linkCreatedAt.set(c.id, "2026-10-01T00:00:00.000Z");
  }

  private ctx(): FactContext {
    return { entities: this.w.entities, factKeys: this.config.factKeys, plans: this.config.plans, now: new Date() };
  }
  private client(id: string) {
    return this.w.entities.clients.find((c) => c.id === id) ?? null;
  }
  private target(clientId: string) {
    return this.w.entities.entities.find((e) => e.client_id === clientId && e.role === "target")!;
  }
  private entityName(id: string) {
    return this.w.entities.entities.find((e) => e.id === id)?.official_name ?? id;
  }
  private staffName(email: string) {
    return this.w.staff.find((s) => s.email === email)?.name ?? email;
  }

  async clientIdForToken(token: string) {
    if (this.w.revokedTokens.includes(token)) return null;
    return Object.entries(this.w.tokens).find(([, t]) => t === token)?.[0] ?? null;
  }

  async loadReportRows(clientId: string): Promise<ReportRows> {
    const c = this.client(clientId)!;
    const t = this.target(clientId);
    const runs = this.w.runs.filter((r) => r.clientIds.includes(clientId));
    const ids = new Set(runs.map((r) => r.id));
    const competitorIds = new Set(t.competitors);
    return {
      client: reportClient(c, t.industry, this.config),
      target: { id: t.id, name: t.official_name, role: "target" },
      competitors: this.w.entities.entities.filter((e) => competitorIds.has(e.id)).map((e) => ({ id: e.id, name: e.official_name, role: "competitor" as const })),
      runs,
      mentions: this.w.mentions.filter((m) => ids.has(m.runId)),
      claims: this.w.claims.filter((x) => ids.has(x.runId)),
      reviews: this.w.reviews,
      citations: this.w.citations.filter((x) => ids.has(x.runId)),
      facts: this.w.facts.filter((f) => f.entityId === t.id),
      factLabels: factLabelsFor(t.industry, this.config.factKeys),
      advice: this.w.advice.filter((a) => a.clientId === clientId),
      requests: this.w.requests.filter((r) => r.clientId === clientId),
      submissions: this.w.submissions.filter((s) => s.clientId === clientId),
    };
  }

  async clientSubmitFact(clientId: string, requestId: string, input: { value: string; validFrom?: string; publicFrom?: string; sourceUrl?: string; note?: string }): Promise<ActionResult> {
    const req = this.w.requests.find((r) => r.id === requestId);
    if (!req) return { ok: false, errors: ["依頼が見つかりません"] };
    const r = submitByClient(this.ctx(), req, clientId, input);
    if (!r.ok) return r;
    Object.assign(req, r.value.request);
    this.w.submissions.push(r.value.submission);
    return { ok: true, message: "送信しました。担当者が確認してから反映します。" };
  }

  async clientAnswerUnknown(clientId: string, requestId: string): Promise<ActionResult> {
    const req = this.w.requests.find((r) => r.id === requestId);
    if (!req) return { ok: false, errors: ["依頼が見つかりません"] };
    const r = answerUnknown(this.ctx(), req, clientId);
    if (!r.ok) return r;
    Object.assign(req, r.value);
    return { ok: true, message: "「分からない」として受け付けました。" };
  }

  async staffByEmail(email: string) {
    const s = this.w.staff.find((x) => x.email === email && x.active);
    return s ? { email: s.email, name: s.name, role: s.role } : null;
  }
  async listStaff(): Promise<Staff[]> {
    return this.w.staff.filter((s) => s.active).map(({ email, name, role }) => ({ email, name, role }));
  }

  private overview(clientId: string): ClientOverview {
    const c = this.client(clientId)!;
    const t = this.target(clientId);
    const plan = this.config.plans.plans[c.plan];
    const runs = this.w.runs.filter((r) => r.clientIds.includes(clientId));
    const monthStart = "2026-11-01";
    const month = runs.filter((r) => jstDate(r.executedAt) >= monthStart);
    const lastMeasurement = runs.map((r) => r.measurementId).sort().at(-1);
    const lastRuns = runs.filter((r) => r.measurementId === lastMeasurement);
    const reviewed = latestReviews(this.w.reviews);
    const runIds = new Set(runs.map((r) => r.id));
    return {
      id: c.id,
      name: c.name,
      plan: c.plan,
      planLabel: plan.label.replace(/（.*）/, ""),
      industry: t.industry,
      targetName: t.official_name,
      nextRun: nextRunDate(c.plan, this.config.plans, DEMO_NOW),
      lastRun: runs.length ? jstDate(runs.map((r) => r.executedAt).sort().at(-1)!) : null,
      monthCostJpy: month.reduce((s, r) => s + r.costJpy / r.clientIds.length, 0),
      capJpy: plan.monthly_cost_cap_jpy,
      missingRate: lastRuns.length ? lastRuns.filter((r) => r.status === "failed").length / lastRuns.length : null,
      pendingReviews: this.w.claims.filter((x) => runIds.has(x.runId) && x.verdict === "incorrect" && !reviewed.has(x.id)).length,
      pendingAdvice: this.w.advice.filter((a) => a.clientId === clientId && a.status === "draft").length,
      openRequests: this.w.requests.filter((r) => r.clientId === clientId && r.status === "open").length,
      pendingSubmissions: this.w.submissions.filter((s) => s.clientId === clientId && s.status === "pending").length,
      linkActive: !!this.w.tokens[clientId],
    };
  }

  async listClients() {
    return this.w.entities.clients.map((c) => this.overview(c.id));
  }

  async clientDetail(clientId: string): Promise<ClientDetail | null> {
    if (!this.client(clientId)) return null;
    const t = this.target(clientId);
    return { ...this.overview(clientId), competitors: t.competitors.map((id) => this.entityName(id)), activeLinkCreatedAt: this.linkCreatedAt.get(clientId) ?? null };
  }

  async issueLink(clientId: string, _staff: Staff) {
    const old = this.w.tokens[clientId];
    if (old) this.w.revokedTokens.push(old);
    const { token } = generateReportToken();
    this.w.tokens[clientId] = token;
    this.linkCreatedAt.set(clientId, new Date().toISOString());
    return { token };
  }

  async pendingReviews(): Promise<ReviewItem[]> {
    const reviewed = latestReviews(this.w.reviews);
    return this.w.claims
      .filter((c) => c.verdict === "incorrect" && !reviewed.has(c.id))
      .map((c) => {
        const run = this.w.runs.find((r) => r.id === c.runId)!;
        const clientId = run.clientIds[0];
        const ent = this.w.entities.entities.find((e) => e.id === c.entityId)!;
        const truth = currentFacts(this.w.facts).find((f) => f.entityId === c.entityId && f.key === c.factKey && f.validTo === null);
        return {
          claimId: c.id,
          clientId,
          clientName: this.client(clientId)!.name,
          targetName: ent.official_name,
          factKey: c.factKey,
          factLabel: factLabelsFor(ent.industry, this.config.factKeys)[c.factKey] ?? c.factKey,
          engine: run.engine,
          statement: c.statement,
          evidence: c.evidence,
          truth: truth ? formatFactValue(truth.value) : null,
          confidence: c.confidence,
          executedAt: run.executedAt,
          sources: dedupeSources(this.w.citations.filter((x) => x.runId === run.id)),
        };
      })
      .sort((a, b) => b.executedAt.localeCompare(a.executedAt));
  }

  async decideClaim(claimId: string, decision: Verdict, note: string | null, staff: Staff): Promise<ActionResult> {
    if (!this.w.claims.some((c) => c.id === claimId)) return { ok: false, errors: ["判定が見つかりません"] };
    this.w.reviews.push({ claimId, decision, reviewer: staff.email, reviewerName: staff.name, reviewedAt: new Date().toISOString(), note });
    return { ok: true };
  }

  async adviceDrafts() {
    return this.w.advice.filter((a) => a.status === "draft").map((a) => ({ ...a, clientName: this.client(a.clientId)!.name }));
  }

  async approveAdvice(adviceId: string, comment: string | null, staff: Staff): Promise<ActionResult> {
    const a = this.w.advice.find((x) => x.id === adviceId);
    if (!a || a.status !== "draft") return { ok: false, errors: ["承認待ちの助言が見つかりません"] };
    Object.assign(a, { status: "approved", approvedBy: staff.email, approvedAt: new Date().toISOString(), comment: comment || a.comment });
    return { ok: true };
  }

  async factsOverview(clientId: string): Promise<FactsOverview | null> {
    const c = this.client(clientId);
    if (!c) return null;
    const targets = this.w.entities.entities.filter((e) => e.client_id === clientId && e.role === "target");
    const ids = new Set(targets.map((t) => t.id));
    const cur = new Set(currentFacts(this.w.facts));
    const label = (entityId: string, key: string) => {
      const ind = this.w.entities.entities.find((e) => e.id === entityId)!.industry;
      return factLabelsFor(ind, this.config.factKeys)[key] ?? key;
    };
    return {
      clientId,
      clientName: c.name,
      targets: targets.map((t) => ({ id: t.id, name: t.official_name, industry: t.industry })),
      facts: this.w.facts
        .filter((f) => ids.has(f.entityId))
        .map((f) => ({ ...f, entityName: this.entityName(f.entityId), factLabel: label(f.entityId, f.key), display: formatFactValue(f.value), current: cur.has(f) }))
        .sort((a, b) => a.key.localeCompare(b.key) || (b.validFrom ?? "").localeCompare(a.validFrom ?? "")),
      requests: this.w.requests
        .filter((r) => r.clientId === clientId)
        .map((r) => ({ ...r, entityName: this.entityName(r.entityId), factLabel: label(r.entityId, r.key), requestedByName: this.staffName(r.requestedBy) })),
      submissions: this.w.submissions
        .filter((s) => s.clientId === clientId)
        .map((s) => ({ ...s, entityName: this.entityName(s.entityId), factLabel: label(s.entityId, s.key) })),
      factKeys: targets.flatMap((t) =>
        Object.entries(this.config.factKeys[t.industry] ?? {}).map(([key, d]) => ({ key, label: d.label, type: d.type, industry: t.industry })),
      ),
    };
  }

  async createRequest(args: { clientId: string; entityId: string; key: string; reason: string }, staff: Staff): Promise<ActionResult> {
    const r = createFactRequest(this.ctx(), this.w.requests, { ...args, staffEmail: staff.email });
    if (!r.ok) return r;
    this.w.requests.push(r.value);
    return { ok: true, message: "記入を依頼しました。顧客の専用URLに表示されます。" };
  }

  async approveSubmission(submissionId: string, closePrevious: boolean, staff: Staff): Promise<ActionResult> {
    const s = this.w.submissions.find((x) => x.id === submissionId);
    if (!s) return { ok: false, errors: ["記入が見つかりません"] };
    const req = s.requestId ? this.w.requests.find((r) => r.id === s.requestId) ?? null : null;
    const r = approveSubmission(this.ctx(), s, req, this.w.facts, staff.email, { closePrevious });
    if (!r.ok) return r;
    this.w.facts.push(...r.value.facts);
    Object.assign(s, r.value.submission);
    if (req && r.value.request) Object.assign(req, r.value.request);
    return { ok: true, message: "承認して正解データに反映しました。" };
  }

  async rejectSubmission(submissionId: string, note: string, staff: Staff): Promise<ActionResult> {
    const s = this.w.submissions.find((x) => x.id === submissionId);
    if (!s) return { ok: false, errors: ["記入が見つかりません"] };
    const req = s.requestId ? this.w.requests.find((r) => r.id === s.requestId) ?? null : null;
    const r = rejectSubmission(this.ctx(), s, req, staff.email, note);
    if (!r.ok) return r;
    Object.assign(s, r.value.submission);
    if (req && r.value.request) Object.assign(req, r.value.request);
    return { ok: true, message: "差し戻しました。理由は顧客の画面に表示されます。" };
  }

  async addStaffFact(input: FactInput, staff: Staff): Promise<ActionResult> {
    const r = prepareStaffFact(this.ctx(), input, this.w.facts, staff.email);
    if (!r.ok) return r;
    this.w.facts.push(r.value);
    return { ok: true, message: r.warnings.length ? `登録しました（${r.warnings.join(" / ")}）` : "登録しました。" };
  }

  async runsOverview(): Promise<RunsOverview> {
    const byM = new Map<string, RunsOverview["measurements"][number]>();
    for (const r of this.w.runs) {
      const m = byM.get(r.measurementId) ?? { id: r.measurementId, clientNames: r.clientIds.map((c) => this.client(c)!.name), scope: "scheduled", startedAt: r.executedAt, planned: 0, ok: 0, failed: 0, skipped: 0, costJpy: 0 };
      m.planned++;
      if (r.status === "ok") m.ok++;
      if (r.status === "failed") m.failed++;
      if (r.status === "skipped_budget") m.skipped++;
      m.costJpy += r.costJpy;
      if (r.executedAt < m.startedAt) m.startedAt = r.executedAt;
      byM.set(r.measurementId, m);
    }
    const month = this.w.runs.filter((r) => jstDate(r.executedAt) >= "2026-11-01");
    const engines = ["openai", "gemini", "perplexity", "claude"] as const;
    return {
      monthCostJpy: month.reduce((s, r) => s + r.costJpy, 0),
      monthCapJpy: this.config.measurement.budget.monthly_jpy,
      byEngine: engines.map((engine) => {
        const rs = month.filter((r) => r.engine === engine);
        return { engine, calls: rs.length, costJpy: rs.reduce((s, r) => s + r.costJpy, 0) };
      }),
      measurements: [...byM.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    };
  }
}

export const DEMO_STAFF_EMAIL = "yamamoto@example.com";
