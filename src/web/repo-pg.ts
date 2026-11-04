// 本番用の Repo（Supabase / Postgres）
import postgres from "postgres";
import type { AppConfig, EngineName } from "../config.ts";
import { type FactContext, type FactInput, type FactRecord, currentFacts } from "../facts.ts";
import type { EntitiesFile } from "../questions/index.ts";
import { formatFactValue } from "../report/compute.ts";
import type { AdviceItem, RAdvice, ReportRows, SourceType, Verdict } from "../report/types.ts";
import {
  type FactRequest,
  type FactSubmission,
  answerUnknown,
  approveSubmission,
  createFactRequest,
  prepareStaffFact,
  rejectSubmission,
  submitByClient,
} from "../workflow/fact-requests.ts";
import { generateReportToken, hashReportToken, isWellFormedToken } from "../workflow/report-links.ts";
import { dedupeSources, factLabelsFor, nextRunDate, reportClient } from "./common.ts";
import type { ActionResult, ClientDetail, ClientOverview, FactsOverview, Repo, ReviewItem, RunsOverview, Staff } from "./repo.ts";

const ymd = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : null);
const iso = (v: unknown) => new Date(v as string).toISOString();

export class PgRepo implements Repo {
  readonly mode = "db" as const;
  private readonly sql: postgres.Sql;
  private readonly config: AppConfig;

  constructor(url: string, config: AppConfig) {
    this.sql = postgres(url, { prepare: false, max: 5 });
    this.config = config;
  }

  private json(v: unknown) {
    return this.sql.json((v ?? null) as postgres.JSONValue);
  }

  private async entitiesFile(): Promise<EntitiesFile> {
    const clients = await this.sql`select id, name, plan from clients order by id`;
    const ents = await this.sql`select id, client_id, industry, role, type, official_name, ambiguous_flag, contexts from entities order by id`;
    const rel = await this.sql`select from_id, to_id from entity_relations where relation = 'competitor'`;
    const aliases = await this.sql`select entity_id, alias from entity_aliases`;
    return {
      clients: clients.map((c) => ({ id: c.id, name: c.name, plan: c.plan })),
      entities: ents.map((e) => ({
        id: e.id, client_id: e.client_id, industry: e.industry, role: e.role, type: e.type, official_name: e.official_name,
        ambiguous: e.ambiguous_flag, aliases: aliases.filter((a) => a.entity_id === e.id).map((a) => a.alias),
        competitors: rel.filter((r) => r.from_id === e.id).map((r) => r.to_id),
        contexts: e.contexts ?? {},
      })),
    };
  }

  private async ctx(): Promise<FactContext> {
    return { entities: await this.entitiesFile(), factKeys: this.config.factKeys, plans: this.config.plans, now: new Date() };
  }

  private async facts(entityIds?: string[]): Promise<FactRecord[]> {
    const rows = entityIds
      ? await this.sql`select * from facts where entity_id in ${this.sql(entityIds)} order by created_at, id`
      : await this.sql`select * from facts order by created_at, id`;
    return rows.map((r) => ({
      entityId: r.entity_id, key: r.key, value: r.value_json, validFrom: ymd(r.valid_from), validTo: ymd(r.valid_to), sourceUrl: r.source_url,
      sourceType: r.source_type, publicFrom: ymd(r.public_from), checkedAt: ymd(r.checked_at)!, note: r.note, importBatch: r.import_batch,
      createdAt: iso(r.created_at),
    }));
  }

  private toRequest(r: postgres.Row): FactRequest {
    return {
      id: r.id, clientId: r.client_id, entityId: r.entity_id, key: r.key, reason: r.reason, requestedBy: r.requested_by,
      requestedAt: iso(r.requested_at), status: r.status, closedAt: r.closed_at ? iso(r.closed_at) : null,
    };
  }

  private toSubmission(r: postgres.Row): FactSubmission {
    return {
      id: r.id, requestId: r.request_id, clientId: r.client_id, entityId: r.entity_id, key: r.key,
      input: {
        value: r.value_raw, validFrom: ymd(r.valid_from), validTo: ymd(r.valid_to), publicFrom: ymd(r.public_from), sourceUrl: r.source_url,
        sourceType: r.source_url ? "public" : "client_provided", checkedAt: ymd(r.submitted_at)!, note: r.note,
      },
      via: r.via, submittedBy: r.submitted_by, submittedAt: iso(r.submitted_at), status: r.status, reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at ? iso(r.reviewed_at) : null, reviewNote: r.review_note,
    };
  }

  private toAdvice(r: postgres.Row): RAdvice {
    const content = r.content_json as { items: AdviceItem[]; comment?: string | null };
    return {
      id: String(r.id), clientId: r.client_id, measurementId: r.measurement_id, createdAt: iso(r.created_at), items: content.items ?? [],
      comment: content.comment ?? null, status: r.status, approvedBy: r.approved_by, approvedAt: r.approved_at ? iso(r.approved_at) : null,
    };
  }

  // ---- 顧客側 ----

  async clientIdForToken(token: string) {
    if (!isWellFormedToken(token)) return null;
    const [row] = await this.sql`update report_links set last_viewed_at = now()
      where token_hash = ${hashReportToken(token)} and revoked_at is null returning client_id`;
    return row?.client_id ?? null;
  }

  async loadReportRows(clientId: string): Promise<ReportRows> {
    const file = await this.entitiesFile();
    const c = file.clients.find((x) => x.id === clientId)!;
    const t = file.entities.find((e) => e.client_id === clientId && e.role === "target")!;
    // この顧客に按分された実行（共有の発見系の質問を含む）
    const runs = await this.sql`select r.id, r.measurement_id, r.question_id, q.category, r.engine, r.executed_at, r.status, r.entity_id, r.cost_jpy, r.context
      from runs r join questions q on q.id = r.question_id
      where r.cost_allocation ? ${clientId} order by r.executed_at`;
    const runIds = runs.map((r) => r.id as string);
    const none = runIds.length === 0;
    // 解析結果は最新の判定バージョンを使う
    const [ver] = none ? [] : await this.sql`select max(analyzer_version) as v from mentions where run_id in ${this.sql(runIds)}`;
    const v = ver?.v ?? "";
    const mentions = none ? [] : await this.sql`select run_id, entity_id, rank from mentions where analyzer_version = ${v} and run_id in ${this.sql(runIds)}`;
    const claims = none ? [] : await this.sql`select id, run_id, entity_id, fact_key, claim_json, verdict, confidence, evidence from claims
      where analyzer_version = ${v} and run_id in ${this.sql(runIds)}`;
    const claimIds = claims.map((x) => x.id);
    const reviews = claimIds.length ? await this.sql`select cr.claim_id, cr.decision, cr.reviewer, s.name, cr.reviewed_at, cr.note
      from claim_reviews cr join staff_members s on s.email = cr.reviewer where cr.claim_id in ${this.sql(claimIds)}` : [];
    const citations = none ? [] : await this.sql`select run_id, url, domain, source_type from citations where analyzer_version = ${v} and run_id in ${this.sql(runIds)}`;
    const advice = await this.sql`select * from report_advice where client_id = ${clientId}`;
    const requests = await this.sql`select * from fact_requests where client_id = ${clientId}`;
    const subs = await this.sql`select * from fact_submissions where client_id = ${clientId}`;
    const competitorIds = new Set(t.competitors);
    return {
      client: reportClient(c, t.industry, this.config),
      target: { id: t.id, name: t.official_name, role: "target" },
      competitors: file.entities.filter((e) => competitorIds.has(e.id)).map((e) => ({ id: e.id, name: e.official_name, role: "competitor" as const })),
      runs: runs.map((r) => ({
        id: r.id, measurementId: r.measurement_id, questionId: r.question_id, category: r.category, engine: r.engine as EngineName,
        executedAt: iso(r.executed_at), status: r.status, entityId: r.entity_id, costJpy: Number(r.cost_jpy),
        context: r.context ?? {},
      })),
      mentions: mentions.map((m) => ({ runId: m.run_id, entityId: m.entity_id, rank: m.rank })),
      claims: claims.map((x) => ({
        id: String(x.id), runId: x.run_id, entityId: x.entity_id, factKey: x.fact_key, statement: x.claim_json?.statement ?? "",
        normalized: x.claim_json?.normalized ?? x.claim_json?.statement ?? "", verdict: x.verdict, confidence: Number(x.confidence), evidence: x.evidence,
      })),
      reviews: reviews.map((r) => ({ claimId: String(r.claim_id), decision: r.decision, reviewer: r.reviewer, reviewerName: r.name, reviewedAt: iso(r.reviewed_at), note: r.note })),
      citations: citations.map((x) => ({ runId: x.run_id, url: x.url, domain: x.domain, sourceType: (x.source_type ?? "other") as SourceType })),
      facts: await this.facts([t.id]),
      factLabels: factLabelsFor(t.industry, this.config.factKeys),
      advice: advice.map((a) => this.toAdvice(a)),
      requests: requests.map((r) => this.toRequest(r)),
      submissions: subs.map((s) => this.toSubmission(s)),
    };
  }

  async clientSubmitFact(clientId: string, requestId: string, input: { value: string; validFrom?: string; publicFrom?: string; sourceUrl?: string; note?: string }): Promise<ActionResult> {
    const [row] = await this.sql`select * from fact_requests where id = ${requestId}`;
    if (!row) return { ok: false, errors: ["依頼が見つかりません"] };
    const r = submitByClient(await this.ctx(), this.toRequest(row), clientId, input);
    if (!r.ok) return r;
    const s = r.value.submission;
    await this.sql.begin(async (sql) => {
      await sql`insert into fact_submissions (id, request_id, client_id, entity_id, key, value_raw, valid_from, valid_to, public_from, source_url, note, via, submitted_by, submitted_at)
        values (${s.id}, ${s.requestId}, ${s.clientId}, ${s.entityId}, ${s.key}, ${s.input.value}, ${s.input.validFrom || null}, ${s.input.validTo || null},
                ${s.input.publicFrom || null}, ${s.input.sourceUrl || null}, ${s.input.note || null}, ${s.via}, ${s.submittedBy}, ${s.submittedAt})`;
      await sql`update fact_requests set status = 'submitted' where id = ${requestId}`;
    });
    return { ok: true, message: "送信しました。担当者が確認してから反映します。" };
  }

  async clientAnswerUnknown(clientId: string, requestId: string): Promise<ActionResult> {
    const [row] = await this.sql`select * from fact_requests where id = ${requestId}`;
    if (!row) return { ok: false, errors: ["依頼が見つかりません"] };
    const r = answerUnknown(await this.ctx(), this.toRequest(row), clientId);
    if (!r.ok) return r;
    await this.sql`update fact_requests set status = 'unknown', closed_at = now() where id = ${requestId}`;
    return { ok: true, message: "「分からない」として受け付けました。" };
  }

  // ---- 社内 ----

  async staffByEmail(email: string): Promise<Staff | null> {
    const [s] = await this.sql`select email, name, role from staff_members where email = ${email.toLowerCase()} and active`;
    return s ? { email: s.email, name: s.name, role: s.role } : null;
  }

  async listStaff(): Promise<Staff[]> {
    const rows = await this.sql`select email, name, role from staff_members where active order by name`;
    return rows.map((s) => ({ email: s.email, name: s.name, role: s.role }));
  }

  async listClients(): Promise<ClientOverview[]> {
    const file = await this.entitiesFile();
    const out: ClientOverview[] = [];
    for (const c of file.clients) out.push(await this.overview(c.id, file));
    return out;
  }

  private async overview(clientId: string, file: EntitiesFile): Promise<ClientOverview> {
    const c = file.clients.find((x) => x.id === clientId)!;
    const t = file.entities.find((e) => e.client_id === clientId && e.role === "target");
    const plan = this.config.plans.plans[c.plan];
    const [cost] = await this.sql`select coalesce(sum(cost_jpy), 0)::float8 as jpy from client_monthly_cost
      where client_id = ${clientId} and month = date_trunc('month', now() at time zone 'Asia/Tokyo')`;
    const [last] = await this.sql`select r.measurement_id, max(r.executed_at) as at, count(*) filter (where r.status = 'failed')::float8 / count(*) as missing
      from runs r where r.cost_allocation ? ${clientId}
      group by r.measurement_id order by max(r.executed_at) desc limit 1`;
    const [pr] = await this.sql`select count(*)::int as n from claims cl join runs r on r.id = cl.run_id
      where r.cost_allocation ? ${clientId} and cl.verdict = 'incorrect'
        and not exists (select 1 from claim_reviews cr where cr.claim_id = cl.id)`;
    const [counts] = await this.sql`select
      (select count(*)::int from report_advice where client_id = ${clientId} and status = 'draft') as advice,
      (select count(*)::int from fact_requests where client_id = ${clientId} and status = 'open') as requests,
      (select count(*)::int from fact_submissions where client_id = ${clientId} and status = 'pending') as subs,
      (select count(*)::int from report_links where client_id = ${clientId} and revoked_at is null) as links`;
    return {
      id: c.id, name: c.name, plan: c.plan, planLabel: plan?.label.replace(/（.*）/, "") ?? c.plan, industry: t?.industry ?? "",
      industryLabel: (t && this.config.industries[t.industry]?.label) || (t?.industry ?? ""),
      targetName: t?.official_name ?? "（対象未登録）", nextRun: nextRunDate(c.plan, this.config.plans, new Date()),
      lastRun: last ? ymd(last.at) : null, monthCostJpy: Number(cost?.jpy ?? 0), capJpy: plan?.monthly_cost_cap_jpy ?? 0,
      missingRate: last ? Number(last.missing) : null, pendingReviews: pr.n, pendingAdvice: counts.advice, openRequests: counts.requests,
      pendingSubmissions: counts.subs, linkActive: counts.links > 0,
    };
  }

  async clientDetail(clientId: string): Promise<ClientDetail | null> {
    const file = await this.entitiesFile();
    if (!file.clients.some((c) => c.id === clientId)) return null;
    const t = file.entities.find((e) => e.client_id === clientId && e.role === "target");
    const [link] = await this.sql`select created_at from report_links where client_id = ${clientId} and revoked_at is null`;
    return {
      ...(await this.overview(clientId, file)),
      competitors: (t?.competitors ?? []).map((id) => file.entities.find((e) => e.id === id)?.official_name ?? id),
      activeLinkCreatedAt: link ? iso(link.created_at) : null,
    };
  }

  async issueLink(clientId: string, staff: Staff) {
    const { token, tokenHash } = generateReportToken();
    await this.sql.begin(async (sql) => {
      await sql`update report_links set revoked_at = now() where client_id = ${clientId} and revoked_at is null`;
      await sql`insert into report_links (token_hash, client_id, created_by) values (${tokenHash}, ${clientId}, ${staff.email})`;
    });
    return { token };
  }

  async pendingReviews(): Promise<ReviewItem[]> {
    const rows = await this.sql`select cl.id, cl.entity_id, cl.fact_key, cl.claim_json, cl.evidence, cl.confidence, r.id as run_id, r.engine, r.executed_at,
        r.cost_allocation, e.official_name, e.industry, e.client_id, c.name as client_name
      from claims cl join runs r on r.id = cl.run_id join entities e on e.id = cl.entity_id join clients c on c.id = e.client_id
      where cl.verdict = 'incorrect' and not exists (select 1 from claim_reviews cr where cr.claim_id = cl.id)
      order by r.executed_at desc limit 200`;
    if (!rows.length) return [];
    const facts = currentFacts(await this.facts([...new Set(rows.map((r) => r.entity_id as string))]));
    const cits = await this.sql`select run_id, domain, source_type from citations where run_id in ${this.sql(rows.map((r) => r.run_id))}`;
    return rows.map((r) => {
      const truth = facts.find((f) => f.entityId === r.entity_id && f.key === r.fact_key && f.validTo === null);
      return {
        claimId: String(r.id), clientId: r.client_id, clientName: r.client_name, targetName: r.official_name, factKey: r.fact_key,
        factLabel: factLabelsFor(r.industry, this.config.factKeys)[r.fact_key] ?? r.fact_key, engine: r.engine, statement: r.claim_json?.statement ?? "",
        evidence: r.evidence, truth: truth ? formatFactValue(truth.value) : null, confidence: Number(r.confidence), executedAt: iso(r.executed_at),
        sources: dedupeSources(cits.filter((x) => x.run_id === r.run_id).map((x) => ({ domain: x.domain as string, sourceType: (x.source_type ?? "other") as SourceType }))),
      };
    });
  }

  async decideClaim(claimId: string, decision: Verdict, note: string | null, staff: Staff): Promise<ActionResult> {
    const [row] = await this.sql`select id from claims where id = ${claimId}`;
    if (!row) return { ok: false, errors: ["判定が見つかりません"] };
    await this.sql`insert into claim_reviews (claim_id, reviewer, decision, note) values (${claimId}, ${staff.email}, ${decision}, ${note})`;
    return { ok: true };
  }

  async adviceDrafts() {
    const rows = await this.sql`select a.*, c.name as client_name from report_advice a join clients c on c.id = a.client_id where a.status = 'draft' order by a.created_at desc`;
    return rows.map((r) => ({ ...this.toAdvice(r), clientName: r.client_name as string }));
  }

  async approveAdvice(adviceId: string, comment: string | null, staff: Staff): Promise<ActionResult> {
    const [row] = await this.sql`select * from report_advice where id = ${adviceId} and status = 'draft'`;
    if (!row) return { ok: false, errors: ["承認待ちの助言が見つかりません"] };
    const content = { ...(row.content_json as object), ...(comment ? { comment } : {}) };
    await this.sql`update report_advice set status = 'approved', approved_by = ${staff.email}, approved_at = now(), content_json = ${this.json(content)} where id = ${adviceId}`;
    return { ok: true };
  }

  async factsOverview(clientId: string): Promise<FactsOverview | null> {
    const file = await this.entitiesFile();
    const c = file.clients.find((x) => x.id === clientId);
    if (!c) return null;
    const targets = file.entities.filter((e) => e.client_id === clientId && e.role === "target");
    const ids = targets.map((t) => t.id);
    const all = ids.length ? await this.facts(ids) : [];
    const cur = new Set(currentFacts(all));
    const staff = await this.listStaff();
    const name = (id: string) => file.entities.find((e) => e.id === id)?.official_name ?? id;
    const label = (entityId: string, key: string) => {
      const ind = file.entities.find((e) => e.id === entityId)?.industry ?? "";
      return factLabelsFor(ind, this.config.factKeys)[key] ?? key;
    };
    const reqs = await this.sql`select * from fact_requests where client_id = ${clientId} order by requested_at desc`;
    const subs = await this.sql`select * from fact_submissions where client_id = ${clientId} order by submitted_at desc`;
    return {
      clientId, clientName: c.name,
      targets: targets.map((t) => ({ id: t.id, name: t.official_name, industry: t.industry })),
      facts: all.map((f) => ({ ...f, entityName: name(f.entityId), factLabel: label(f.entityId, f.key), display: formatFactValue(f.value), current: cur.has(f) }))
        .sort((a, b) => a.key.localeCompare(b.key) || (b.validFrom ?? "").localeCompare(a.validFrom ?? "")),
      requests: reqs.map((r) => {
        const q = this.toRequest(r);
        return { ...q, entityName: name(q.entityId), factLabel: label(q.entityId, q.key), requestedByName: staff.find((s) => s.email === q.requestedBy)?.name ?? q.requestedBy };
      }),
      submissions: subs.map((s) => {
        const x = this.toSubmission(s);
        return { ...x, entityName: name(x.entityId), factLabel: label(x.entityId, x.key) };
      }),
      factKeys: targets.flatMap((t) => Object.entries(this.config.factKeys[t.industry] ?? {}).map(([key, d]) => ({ key, label: d.label, type: d.type, industry: t.industry }))),
    };
  }

  async createRequest(args: { clientId: string; entityId: string; key: string; reason: string }, staff: Staff): Promise<ActionResult> {
    const existing = (await this.sql`select * from fact_requests where entity_id = ${args.entityId}`).map((r) => this.toRequest(r));
    const r = createFactRequest(await this.ctx(), existing, { ...args, staffEmail: staff.email });
    if (!r.ok) return r;
    const q = r.value;
    await this.sql`insert into fact_requests (id, client_id, entity_id, key, reason, requested_by, requested_at)
      values (${q.id}, ${q.clientId}, ${q.entityId}, ${q.key}, ${q.reason}, ${q.requestedBy}, ${q.requestedAt})`;
    return { ok: true, message: "記入を依頼しました。顧客の専用URLに表示されます。" };
  }

  async approveSubmission(submissionId: string, closePrevious: boolean, staff: Staff): Promise<ActionResult> {
    const [row] = await this.sql`select * from fact_submissions where id = ${submissionId}`;
    if (!row) return { ok: false, errors: ["記入が見つかりません"] };
    const s = this.toSubmission(row);
    const [reqRow] = s.requestId ? await this.sql`select * from fact_requests where id = ${s.requestId}` : [];
    const r = approveSubmission(await this.ctx(), s, reqRow ? this.toRequest(reqRow) : null, await this.facts([s.entityId]), staff.email, { closePrevious });
    if (!r.ok) return r;
    await this.sql.begin(async (sql) => {
      for (const f of r.value.facts) {
        await sql`insert into facts (entity_id, key, value_json, valid_from, valid_to, source_url, source_type, public_from, checked_at, note, import_batch, created_at)
          values (${f.entityId}, ${f.key}, ${this.json(f.value)}, ${f.validFrom}, ${f.validTo}, ${f.sourceUrl}, ${f.sourceType}, ${f.publicFrom},
                  ${f.checkedAt}, ${f.note}, ${f.importBatch}, ${f.createdAt})`;
      }
      await sql`update fact_submissions set status = 'approved', reviewed_by = ${staff.email}, reviewed_at = now() where id = ${submissionId}`;
      if (s.requestId) await sql`update fact_requests set status = 'answered', closed_at = now() where id = ${s.requestId}`;
    });
    return { ok: true, message: "承認して正解データに反映しました。" };
  }

  async rejectSubmission(submissionId: string, note: string, staff: Staff): Promise<ActionResult> {
    const [row] = await this.sql`select * from fact_submissions where id = ${submissionId}`;
    if (!row) return { ok: false, errors: ["記入が見つかりません"] };
    const s = this.toSubmission(row);
    const r = rejectSubmission(await this.ctx(), s, null, staff.email, note);
    if (!r.ok) return r;
    await this.sql.begin(async (sql) => {
      await sql`update fact_submissions set status = 'rejected', reviewed_by = ${staff.email}, reviewed_at = now(), review_note = ${note.trim()} where id = ${submissionId}`;
      if (s.requestId) await sql`update fact_requests set status = 'open' where id = ${s.requestId}`;
    });
    return { ok: true, message: "差し戻しました。理由は顧客の画面に表示されます。" };
  }

  async addStaffFact(input: FactInput, staff: Staff): Promise<ActionResult> {
    const r = prepareStaffFact(await this.ctx(), input, await this.facts([input.entityId]), staff.email);
    if (!r.ok) return r;
    const f = r.value;
    await this.sql`insert into facts (entity_id, key, value_json, valid_from, valid_to, source_url, source_type, public_from, checked_at, note, import_batch, created_at)
      values (${f.entityId}, ${f.key}, ${this.json(f.value)}, ${f.validFrom}, ${f.validTo}, ${f.sourceUrl}, ${f.sourceType}, ${f.publicFrom},
              ${f.checkedAt}, ${f.note}, ${f.importBatch}, ${f.createdAt})`;
    return { ok: true, message: r.warnings.length ? `登録しました（${r.warnings.join(" / ")}）` : "登録しました。" };
  }

  async runsOverview(): Promise<RunsOverview> {
    const ms = await this.sql`select m.id, m.scope, m.started_at, m.planned_calls,
        count(r.*) filter (where r.status = 'ok')::int as ok, count(r.*) filter (where r.status = 'failed')::int as failed,
        count(r.*) filter (where r.status = 'skipped_budget')::int as skipped, coalesce(sum(r.cost_jpy), 0)::float8 as jpy,
        (select array_agg(distinct c.name) from runs r2, jsonb_object_keys(r2.cost_allocation) k join clients c on c.id = k where r2.measurement_id = m.id) as clients
      from measurements m left join runs r on r.measurement_id = m.id
      group by m.id order by m.started_at desc limit 50`;
    const eng = await this.sql`select engine, count(*)::int as calls, coalesce(sum(cost_jpy), 0)::float8 as jpy from runs
      where executed_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo' group by engine`;
    const engines: EngineName[] = ["openai", "gemini", "perplexity", "claude"];
    return {
      monthCostJpy: eng.reduce((s, e) => s + Number(e.jpy), 0),
      monthCapJpy: this.config.measurement.budget.monthly_jpy,
      byEngine: engines.map((engine) => {
        const e = eng.find((x) => x.engine === engine);
        return { engine, calls: e?.calls ?? 0, costJpy: Number(e?.jpy ?? 0) };
      }),
      measurements: ms.map((m) => ({
        id: m.id, clientNames: m.clients ?? [], scope: m.scope, startedAt: iso(m.started_at), planned: m.planned_calls, ok: m.ok,
        failed: m.failed, skipped: m.skipped, costJpy: Number(m.jpy),
      })),
    };
  }
}
