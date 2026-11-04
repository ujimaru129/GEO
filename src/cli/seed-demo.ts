// デモデータ（架空の3社）を DB に入れる。画面の確認・営業デモ用。
//   DATABASE_URL=... npm run seed:demo
// 既に demo- で始まる顧客があれば何もしない（--force で入れ直し）
import postgres from "postgres";
import { loadConfig } from "../config.ts";
import { normalizeName } from "../normalize.ts";
import { buildDemoWorld, demoToken } from "../report/demo.ts";
import { hashReportToken } from "../workflow/report-links.ts";
import { parseArgs } from "./common.ts";

const args = parseArgs(process.argv.slice(2));
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL を設定してください");
const sql = postgres(url, { prepare: false, max: 1 });
const config = loadConfig();
const w = buildDemoWorld();
const VERSION = "demo-1";

try {
  const [exists] = await sql`select count(*)::int as n from clients where id like 'demo-%'`;
  if (exists.n > 0 && !args.force) {
    console.log("デモデータは登録済みです（入れ直す場合は --force）");
    process.exit(0);
  }
  await sql.begin(async (tx) => {
    const j = (v: unknown) => tx.json(v as postgres.JSONValue);
    if (args.force) {
      const runIds = tx`select id from runs where measurement_id like 'demo-%'`;
      await tx`delete from claim_reviews where claim_id in (select id from claims where run_id in (${runIds}))`;
      await tx`delete from report_advice where client_id like 'demo-%'`;
      for (const t of ["mentions", "claims", "citations", "responses"]) await tx`delete from ${tx(t)} where run_id in (${runIds})`;
      await tx`delete from runs where measurement_id like 'demo-%'`;
      await tx`delete from measurements where id like 'demo-%'`;
      await tx`delete from fact_submissions where client_id like 'demo-%'`;
      await tx`delete from fact_requests where client_id like 'demo-%'`;
      await tx`delete from report_links where client_id like 'demo-%'`;
      await tx`delete from facts where entity_id in (select id from entities where client_id like 'demo-%')`;
      await tx`delete from entity_relations where from_id in (select id from entities where client_id like 'demo-%')`;
      await tx`delete from entity_aliases where entity_id in (select id from entities where client_id like 'demo-%')`;
      await tx`delete from entities where client_id like 'demo-%'`;
      await tx`delete from clients where id like 'demo-%'`;
    }
    for (const s of w.staff) {
      await tx`insert into staff_members (email, name, role) values (${s.email}, ${s.name}, ${s.role}) on conflict (email) do nothing`;
    }
    for (const c of w.entities.clients) await tx`insert into clients (id, name, plan) values (${c.id}, ${c.name}, ${c.plan})`;
    for (const e of w.entities.entities) {
      await tx`insert into entities (id, client_id, industry, role, type, official_name, ambiguous_flag)
        values (${e.id}, ${e.client_id}, ${e.industry}, ${e.role}, ${e.type}, ${e.official_name}, ${e.ambiguous})`;
      await tx`insert into entity_aliases (entity_id, alias, normalized) values (${e.id}, ${e.official_name}, ${normalizeName(e.official_name)})`;
    }
    for (const e of w.entities.entities) for (const c of e.competitors) await tx`insert into entity_relations (from_id, to_id, relation) values (${e.id}, ${c}, 'competitor')`;
    const qids = new Map(w.runs.map((r) => [r.questionId, r.category]));
    for (const [id, category] of qids) {
      await tx`insert into questions (id, industry, category, template, priority) values (${id}, ${id.split("-")[0]}, ${category}, ${"（デモ用の質問）"}, 'normal')
        on conflict (id) do nothing`;
    }
    await tx`insert into config_snapshots (hash, snapshot) values (${config.snapshotHash}, ${j(config.snapshot)}) on conflict (hash) do nothing`;
    const ms = new Map<string, { at: string; n: number }>();
    for (const r of w.runs) {
      const m = ms.get(r.measurementId) ?? { at: r.executedAt, n: 0 };
      m.n++;
      if (r.executedAt < m.at) m.at = r.executedAt;
      ms.set(r.measurementId, m);
    }
    for (const [id, m] of ms) {
      await tx`insert into measurements (id, scope, started_at, finished_at, config_hash, planned_calls, estimated_usd)
        values (${id}, 'scheduled', ${m.at}, ${m.at}, ${config.snapshotHash}, ${m.n}, 0)`;
    }
    const fx = config.measurement.budget.fx_jpy_per_usd;
    const trial = new Map<string, number>();
    for (const r of w.runs) {
      const ctx = Object.keys(r.context).sort().map((k) => `${k}=${r.context[k]}`).join(",");
      const promptKey = `${r.questionId}|v0|${r.entityId ?? "-"}|-${ctx ? `|${ctx}` : ""}`;
      const key = `${r.measurementId}|${promptKey}|${r.engine}`;
      const trialNo = (trial.get(key) ?? 0) + 1;
      trial.set(key, trialNo);
      await tx`insert into runs (id, measurement_id, prompt_key, question_id, entity_id, variant, context, prompt_text, engine, model, trial_no, executed_at, status,
          attempts, cost_usd, cost_jpy, cost_allocation, config_hash)
        values (${r.id}, ${r.measurementId}, ${promptKey}, ${r.questionId}, ${r.entityId}, 0, ${j(r.context)}, ${"（デモ）"}, ${r.engine},
          ${`demo-${r.engine}`}, ${trialNo}, ${r.executedAt}, ${r.status}, 1, ${r.costJpy / fx}, ${r.costJpy},
          ${j(Object.fromEntries(r.clientIds.map((c) => [c, 1 / r.clientIds.length])))}, ${config.snapshotHash})`;
    }
    for (const m of w.mentions) {
      await tx`insert into mentions (run_id, entity_id, rank, method, analyzer_version) values (${m.runId}, ${m.entityId}, ${m.rank}, 'rule', ${VERSION})
        on conflict do nothing`;
    }
    const claimId = new Map<string, number>();
    for (const c of w.claims) {
      const [row] = await tx`insert into claims (run_id, entity_id, fact_key, claim_json, verdict, confidence, evidence, analyzer_version)
        values (${c.runId}, ${c.entityId}, ${c.factKey}, ${j({ statement: c.statement, normalized: c.normalized })}, ${c.verdict}, ${c.confidence}, ${c.evidence}, ${VERSION})
        returning id`;
      claimId.set(c.id, Number(row.id));
    }
    for (const r of w.reviews) {
      await tx`insert into claim_reviews (claim_id, reviewer, decision, note, reviewed_at) values (${claimId.get(r.claimId)!}, ${r.reviewer}, ${r.decision}, ${r.note}, ${r.reviewedAt})`;
    }
    for (const c of w.citations) {
      await tx`insert into citations (run_id, url, domain, source_type, analyzer_version) values (${c.runId}, ${c.url}, ${c.domain}, ${c.sourceType}, ${VERSION})
        on conflict do nothing`;
    }
    for (const f of w.facts) {
      await tx`insert into facts (entity_id, key, value_json, valid_from, valid_to, source_url, source_type, public_from, checked_at, note, import_batch, created_at)
        values (${f.entityId}, ${f.key}, ${j(f.value)}, ${f.validFrom}, ${f.validTo}, ${f.sourceUrl}, ${f.sourceType}, ${f.publicFrom}, ${f.checkedAt}, ${f.note},
          ${f.importBatch}, ${f.createdAt})`;
    }
    for (const a of w.advice) {
      await tx`insert into report_advice (client_id, measurement_id, content_json, generator_version, status, approved_by, approved_at, created_at)
        values (${a.clientId}, ${a.measurementId}, ${j({ items: a.items, comment: a.comment })}, 'demo', ${a.status}, ${a.approvedBy}, ${a.approvedAt}, ${a.createdAt})`;
    }
    for (const r of w.requests) {
      await tx`insert into fact_requests (id, client_id, entity_id, key, reason, requested_by, requested_at, status)
        values (${r.id}, ${r.clientId}, ${r.entityId}, ${r.key}, ${r.reason}, ${r.requestedBy}, ${r.requestedAt}, ${r.status})`;
    }
    for (const s of w.submissions) {
      await tx`insert into fact_submissions (id, request_id, client_id, entity_id, key, value_raw, valid_from, public_from, source_url, note, via, submitted_by, submitted_at)
        values (${s.id}, ${s.requestId}, ${s.clientId}, ${s.entityId}, ${s.key}, ${s.input.value}, ${s.input.validFrom ?? null}, ${s.input.publicFrom ?? null},
          ${s.input.sourceUrl ?? null}, ${s.input.note ?? null}, ${s.via}, ${s.submittedBy}, ${s.submittedAt})`;
    }
    for (const c of w.entities.clients) {
      await tx`insert into report_links (token_hash, client_id, created_by) values (${hashReportToken(demoToken(c.id))}, ${c.id}, ${w.staff[0].email})`;
    }
  });
  console.log(`デモデータを登録しました（${w.runs.length}回答）。専用URL:`);
  for (const c of w.entities.clients) console.log(`  ${c.name}: /r/${demoToken(c.id)}`);
} finally {
  await sql.end();
}
