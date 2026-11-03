import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { FactKeys, Plan, PlansConfig } from "../config.ts";

export const CATEGORIES = ["discovery", "entity", "comparison", "recency"] as const;
export const ENTITY_TYPES = ["group", "artist", "member", "title", "company"] as const;

export const questionSchema = z.object({
  id: z.string().regex(/^[a-z]+-[a-z]+-\d{3}$/),
  category: z.enum(CATEGORIES),
  template: z.string().min(1),
  variables: z.array(z.string()).default([]),
  fact_keys: z.array(z.string()).default([]),
  priority: z.enum(["high", "normal"]).default("normal"),
  /** 言い回し違い。結果の差（パターン間の差）を記録するため、別の prompt として計測する */
  paraphrases: z.array(z.string()).default([]),
  /** question_set が all 以外のプランで計測対象にする場合に、そのプラン名を書く（例: [lite]） */
  plans: z.array(z.string()).default([]),
});
export const questionFileSchema = z.object({
  industry: z.string(),
  questions: z.array(questionSchema),
});
export type Question = z.infer<typeof questionSchema> & { industry: string };

export const entitySchema = z.object({
  id: z.string(),
  client_id: z.string(),
  industry: z.string(),
  role: z.enum(["target", "competitor"]),
  type: z.enum(ENTITY_TYPES),
  official_name: z.string(),
  aliases: z.array(z.string()).default([]),
  /** 一般名詞と同じ名前など。言及検出で文脈判定を必須にする */
  ambiguous: z.boolean().default(false),
  /** target のみ。比較・シェア計測の相手 */
  competitors: z.array(z.string()).default([]),
});
export const clientSchema = z.object({ id: z.string(), name: z.string(), plan: z.string() });
export const entitiesFileSchema = z.object({
  clients: z.array(clientSchema),
  entities: z.array(entitySchema),
});
export type Entity = z.infer<typeof entitySchema>;
export type Client = z.infer<typeof clientSchema>;
export type EntitiesFile = z.infer<typeof entitiesFileSchema>;

export function loadQuestions(dir: string, factKeys?: FactKeys): Question[] {
  const all: Question[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".yaml")).sort()) {
    const file = questionFileSchema.parse(parse(readFileSync(join(dir, f), "utf8")));
    for (const q of file.questions) all.push({ ...q, industry: file.industry });
  }
  validateQuestions(all, factKeys);
  return all;
}

export function loadEntities(path: string, plans?: PlansConfig): EntitiesFile {
  const file = entitiesFileSchema.parse(parse(readFileSync(path, "utf8")));
  validateEntities(file, plans);
  return file;
}

export function validateEntities(file: EntitiesFile, plans?: PlansConfig) {
  const ids = new Set<string>();
  for (const e of file.entities) {
    if (ids.has(e.id)) throw new Error(`entities: ID が重複しています: ${e.id}`);
    ids.add(e.id);
  }
  const clients = new Map(file.clients.map((c) => [c.id, c]));
  for (const c of file.clients) {
    if (plans && !plans.plans[c.plan]) throw new Error(`clients: ${c.id} のプラン ${c.plan} が plans.yaml にありません`);
  }
  for (const e of file.entities) {
    const client = clients.get(e.client_id);
    if (!client) throw new Error(`entities: ${e.id} の client_id ${e.client_id} が clients にありません`);
    for (const c of e.competitors) if (!ids.has(c)) throw new Error(`entities: ${e.id} の競合 ${c} が未登録です`);
    const plan = plans?.plans[client.plan];
    if (plan && e.role === "target" && e.competitors.length > plan.max_competitors) {
      throw new Error(`entities: ${e.id} の競合は ${e.competitors.length} 件ですが、プラン ${client.plan} の上限は ${plan.max_competitors} 件です`);
    }
  }
}

function validateQuestions(qs: Question[], factKeys?: FactKeys) {
  const seen = new Set<string>();
  for (const q of qs) {
    if (seen.has(q.id)) throw new Error(`質問IDが重複しています: ${q.id}`);
    seen.add(q.id);
    const placeholders = new Set([...q.template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    for (const v of q.variables) if (!placeholders.has(v)) throw new Error(`${q.id}: 変数 {${v}} がテンプレートにありません`);
    for (const p of placeholders) if (!q.variables.includes(p)) throw new Error(`${q.id}: {${p}} が variables に宣言されていません`);
    for (const para of q.paraphrases) {
      const pp = new Set([...para.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
      if ([...pp].sort().join() !== [...placeholders].sort().join()) throw new Error(`${q.id}: 言い換えの変数がテンプレートと一致しません`);
    }
    if (factKeys) {
      for (const k of q.fact_keys) {
        if (!factKeys[q.industry]?.[k]) throw new Error(`${q.id}: fact_keys の ${k} が config/fact_keys.yaml（${q.industry}）にありません`);
      }
    }
  }
}

/** 変数を埋めた、実際に AI に投げる1件の質問 */
export type Prompt = {
  key: string;
  questionId: string;
  industry: string;
  category: Question["category"];
  priority: Question["priority"];
  variant: number; // 0 = 元テンプレート, 1.. = 言い換え
  entityId: string | null;
  competitorId: string | null;
  /** この質問の計測結果を使う顧客。発見カテゴリは同じ業界の顧客で共有するため複数になる */
  clientIds: string[];
  text: string;
};

export function planIncludesQuestion(plan: Plan, planName: string, q: Question): boolean {
  return plan.question_set === "all" || q.plans.includes(planName);
}

/**
 * テンプレート × 対象 で展開する。コストを抑えるため:
 * - 対象名を含む質問（指名・新着など）は role=target の対象にだけ展開する（競合には展開しない）
 * - {competitor} を含む質問（比較）だけ、target × その競合 で展開する
 * - 変数なしの質問（発見）は業界ごとに1件で、その業界の顧客全員で共有する。競合はこの回答の中から検出する
 * plans を渡すと、顧客のプラン（質問セット・言い換えの有無）に含まれない質問は展開しない。
 */
export function expandPrompts(questions: Question[], file: EntitiesFile, plans?: PlansConfig): Prompt[] {
  const entities = file.entities;
  const byId = new Map(entities.map((e) => [e.id, e]));
  const clientPlan = new Map(file.clients.map((c) => [c.id, c.plan]));
  /** 顧客がこの質問・言い換え番号を計測するか */
  const wants = (clientId: string, q: Question, variant: number) => {
    if (!plans) return true;
    const name = clientPlan.get(clientId)!;
    const plan = plans.plans[name];
    return planIncludesQuestion(plan, name, q) && (variant === 0 || plan.paraphrases);
  };

  const prompts: Prompt[] = [];
  for (const q of questions) {
    const templates = [q.template, ...q.paraphrases];
    const targets = entities.filter((e) => e.industry === q.industry && e.role === "target");
    const entityVars = q.variables.filter((v) => v !== "competitor");
    const combos: { target: Entity | null; competitor: Entity | null }[] = [];
    if (q.variables.length === 0) combos.push({ target: null, competitor: null });
    else {
      for (const t of targets) {
        if (entityVars.some((v) => v !== "target" && v !== t.type)) continue; // {group} は type=group の対象だけ
        if (q.variables.includes("competitor")) {
          for (const cid of t.competitors) combos.push({ target: t, competitor: byId.get(cid)! });
        } else combos.push({ target: t, competitor: null });
      }
    }
    const industryClients = [...new Set(targets.map((t) => t.client_id))];
    templates.forEach((tpl, variant) => {
      for (const { target, competitor } of combos) {
        const candidates = target ? [target.client_id] : industryClients;
        const clientIds = candidates.filter((c) => wants(c, q, variant));
        if (clientIds.length === 0) continue;
        const text = tpl.replace(/\{(\w+)\}/g, (_, v: string) => (v === "competitor" ? competitor!.official_name : target!.official_name));
        prompts.push({
          key: `${q.id}|v${variant}|${target?.id ?? "-"}|${competitor?.id ?? "-"}`,
          questionId: q.id,
          industry: q.industry,
          category: q.category,
          priority: q.priority,
          variant,
          entityId: target?.id ?? null,
          competitorId: competitor?.id ?? null,
          clientIds,
          text,
        });
      }
    });
  }
  return prompts;
}
