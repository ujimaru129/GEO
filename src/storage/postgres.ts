import postgres from "postgres";
import type { FactRecord } from "../facts.ts";
import { normalizeName } from "../normalize.ts";
import type { EntitiesFile, Question } from "../questions/index.ts";
import { jstMonthStart, type MeasurementRecord, type ResponseRecord, type RunRecord, type Storage } from "./types.ts";


export class PostgresStorage implements Storage {
  private readonly sql: postgres.Sql;

  /** jsonb 列への値（文字列化して渡すと jsonb の文字列スカラーとして保存されてしまうため） */
  private json(v: unknown) {
    return this.sql.json((v ?? null) as postgres.JSONValue);
  }

  constructor(url: string) {
    // Supabase のトランザクションモード pooler では prepared statement を使えないため prepare: false
    this.sql = postgres(url, { prepare: false, max: 5 });
  }

  async syncDictionary(questions: Question[], file: EntitiesFile) {
    await this.sql.begin(async (sql) => {
      for (const c of file.clients) {
        await sql`insert into clients (id, name, plan) values (${c.id}, ${c.name}, ${c.plan})
                  on conflict (id) do update set name = excluded.name, plan = excluded.plan`;
      }
      for (const e of file.entities) {
        await sql`insert into entities (id, client_id, industry, role, type, official_name, ambiguous_flag, contexts, updated_at)
                  values (${e.id}, ${e.client_id}, ${e.industry}, ${e.role}, ${e.type}, ${e.official_name}, ${e.ambiguous}, ${this.json(e.contexts)}, now())
                  on conflict (id) do update set client_id = excluded.client_id, industry = excluded.industry, role = excluded.role,
                    type = excluded.type, official_name = excluded.official_name, ambiguous_flag = excluded.ambiguous_flag,
                    contexts = excluded.contexts, updated_at = now()`;
        await sql`delete from entity_aliases where entity_id = ${e.id}`;
        for (const alias of new Set([e.official_name, ...e.aliases])) {
          await sql`insert into entity_aliases (entity_id, alias, normalized) values (${e.id}, ${alias}, ${normalizeName(alias)})`;
        }
      }
      for (const e of file.entities) {
        await sql`delete from entity_relations where from_id = ${e.id} and relation = 'competitor'`;
        for (const c of e.competitors) {
          await sql`insert into entity_relations (from_id, to_id, relation) values (${e.id}, ${c}, 'competitor')`;
        }
      }
      for (const q of questions) {
        await sql`insert into questions (id, industry, category, template, paraphrases, variables, contexts, period, priority, fact_keys, synced_at)
                  values (${q.id}, ${q.industry}, ${q.category}, ${q.template}, ${this.json(q.paraphrases)}, ${this.json(q.variables)},
                          ${this.json(q.contexts)}, ${q.period ? this.json(q.period) : null}, ${q.priority}, ${this.json(q.fact_keys)}, now())
                  on conflict (id) do update set industry = excluded.industry, category = excluded.category, template = excluded.template,
                    paraphrases = excluded.paraphrases, variables = excluded.variables, contexts = excluded.contexts, period = excluded.period,
                    priority = excluded.priority,
                    fact_keys = excluded.fact_keys, synced_at = now()`;
      }
    });
  }

  async saveConfigSnapshot(hash: string, snapshot: unknown) {
    await this.sql`insert into config_snapshots (hash, snapshot) values (${hash}, ${this.json(snapshot)}) on conflict (hash) do nothing`;
  }

  async createMeasurement(m: MeasurementRecord) {
    await this.sql`insert into measurements (id, scope, started_at, config_hash, planned_calls, estimated_usd)
                   values (${m.id}, ${m.scope}, ${m.startedAt}, ${m.configHash}, ${m.plannedCalls}, ${m.estimatedUsd})`;
  }

  async recordRun(r: RunRecord, response: ResponseRecord | null) {
    // 生データは insert のみ（unique 制約により同じ試行の上書きはエラーになる）
    await this.sql.begin(async (sql) => {
      await sql`insert into runs (id, measurement_id, prompt_key, question_id, entity_id, competitor_id, variant, context, prompt_text, engine, model,
                  trial_no, executed_at, status, attempts, latency_ms, input_tokens, output_tokens, reasoning_tokens, search_count,
                  cost_usd, cost_jpy, cost_allocation, error, config_hash)
                values (${r.id}, ${r.measurementId}, ${r.promptKey}, ${r.questionId}, ${r.entityId}, ${r.competitorId}, ${r.variant},
                  ${this.json(r.context)}, ${r.promptText}, ${r.engine}, ${r.model}, ${r.trialNo}, ${r.executedAt}, ${r.status}, ${r.attempts}, ${r.latencyMs},
                  ${r.inputTokens}, ${r.outputTokens}, ${r.reasoningTokens}, ${r.searchCount}, ${r.costUsd}, ${r.costJpy}, ${this.json(r.costAllocation)}, ${r.error},
                  ${r.configHash})`;
      if (response) {
        await sql`insert into responses (run_id, text, citations_json, request_json, raw_json)
                  values (${response.runId}, ${response.text}, ${this.json(response.citations)}, ${this.json(response.request)},
                          ${this.json(response.raw)})`;
      }
    });
  }

  async finishMeasurement(id: string, summary: unknown) {
    await this.sql`update measurements set finished_at = now(), summary = ${this.json(summary)} where id = ${id}`;
  }

  async monthToDateCostUsd(now: Date) {
    const [row] = await this.sql`select coalesce(sum(cost_usd), 0)::float8 as usd from runs where executed_at >= ${jstMonthStart(now).toISOString()}::timestamptz`;
    return Number(row.usd);
  }

  async monthToDateCostUsdByClient(now: Date) {
    const rows = await this.sql`select a.key as client_id, sum(r.cost_usd * a.value::numeric)::float8 as usd
      from runs r, jsonb_each_text(r.cost_allocation) a
      where r.executed_at >= ${jstMonthStart(now).toISOString()}::timestamptz group by a.key`;
    return Object.fromEntries(rows.map((r) => [r.client_id as string, Number(r.usd)]));
  }

  async insertFacts(facts: FactRecord[]) {
    if (facts.length === 0) return;
    await this.sql.begin(async (sql) => {
      for (const f of facts) {
        await sql`insert into facts (entity_id, key, value_json, valid_from, valid_to, source_url, source_type, public_from, checked_at, note,
                    import_batch, created_at)
                  values (${f.entityId}, ${f.key}, ${this.json(f.value)}, ${f.validFrom}, ${f.validTo}, ${f.sourceUrl}, ${f.sourceType},
                          ${f.publicFrom}, ${f.checkedAt}, ${f.note}, ${f.importBatch}, ${f.createdAt})`;
      }
    });
  }

  async listFacts(): Promise<FactRecord[]> {
    const rows = await this.sql`select entity_id, key, value_json, to_char(valid_from, 'YYYY-MM-DD') as valid_from,
      to_char(valid_to, 'YYYY-MM-DD') as valid_to, source_url, source_type, to_char(public_from, 'YYYY-MM-DD') as public_from,
      to_char(checked_at, 'YYYY-MM-DD') as checked_at, note, import_batch,
      created_at from facts order by created_at, id`;
    return rows.map((r) => ({
      entityId: r.entity_id, key: r.key, value: r.value_json, validFrom: r.valid_from, validTo: r.valid_to, sourceUrl: r.source_url,
      sourceType: r.source_type, publicFrom: r.public_from,
      checkedAt: r.checked_at, note: r.note, importBatch: r.import_batch, createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  async close() {
    await this.sql.end();
  }
}
