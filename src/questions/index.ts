import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

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
export const entitiesFileSchema = z.object({
  clients: z.array(z.object({ id: z.string(), name: z.string() })),
  entities: z.array(entitySchema),
});
export type Entity = z.infer<typeof entitySchema>;
export type EntitiesFile = z.infer<typeof entitiesFileSchema>;

export function loadQuestions(dir: string): Question[] {
  const all: Question[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".yaml")).sort()) {
    const file = questionFileSchema.parse(parse(readFileSync(join(dir, f), "utf8")));
    for (const q of file.questions) all.push({ ...q, industry: file.industry });
  }
  validateQuestions(all);
  return all;
}

export function loadEntities(path: string): EntitiesFile {
  const file = entitiesFileSchema.parse(parse(readFileSync(path, "utf8")));
  const ids = new Set(file.entities.map((e) => e.id));
  for (const e of file.entities) {
    for (const c of e.competitors) if (!ids.has(c)) throw new Error(`entities: ${e.id} の競合 ${c} が未登録です`);
  }
  return file;
}

function validateQuestions(qs: Question[]) {
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
  text: string;
};

/**
 * テンプレート × 対象 で展開する。コストを抑えるため:
 * - 対象名を含む質問（指名・新着など）は role=target の対象にだけ展開する（競合には展開しない）
 * - {competitor} を含む質問（比較）だけ、target × その競合 で展開する
 * - 変数なしの質問（発見）は業界ごとに1件。競合はこの回答の中から検出する
 */
export function expandPrompts(questions: Question[], entities: Entity[]): Prompt[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
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
    templates.forEach((tpl, variant) => {
      for (const { target, competitor } of combos) {
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
          text,
        });
      }
    });
  }
  return prompts;
}
