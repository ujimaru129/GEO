import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { z } from "zod";

export const ENGINE_NAMES = ["openai", "gemini", "perplexity", "claude"] as const;
export type EngineName = (typeof ENGINE_NAMES)[number];

const pricingSchema = z.object({
  input_per_mtok: z.number().nonnegative(),
  output_per_mtok: z.number().nonnegative(),
  search_per_1k: z.number().nonnegative().default(0),
  search_free_per_month: z.number().int().nonnegative().default(0),
  flex_token_multiplier: z.number().positive().default(1),
});
export type EnginePricing = z.infer<typeof pricingSchema>;

const userLocation = z.record(z.string(), z.string());

export const enginesConfigSchema = z.object({
  openai: z.object({
    enabled: z.boolean(),
    model: z.string(),
    service_tier: z.enum(["flex", "default", "auto"]).default("default"),
    flex_fallback_to_standard: z.boolean().default(true),
    web_search: z.object({
      search_context_size: z.enum(["low", "medium", "high"]).default("medium"),
      user_location: userLocation.optional(),
    }),
    pricing: pricingSchema,
  }),
  gemini: z.object({
    enabled: z.boolean(),
    model: z.string(),
    pricing: pricingSchema,
  }),
  perplexity: z.object({
    enabled: z.boolean(),
    model: z.string(),
    web_search: z.object({
      search_type: z.enum(["web", "fast"]).default("web"),
      user_location: userLocation.optional(),
    }),
    pricing: pricingSchema,
  }),
  claude: z.object({
    enabled: z.boolean(),
    model: z.string(),
    web_search: z.object({
      tool_type: z.string(),
      max_uses: z.number().int().positive().optional(),
      user_location: userLocation.optional(),
    }),
    max_tokens: z.number().int().positive(),
    pricing: pricingSchema,
  }),
});
export type EnginesConfig = z.infer<typeof enginesConfigSchema>;

export const measurementConfigSchema = z.object({
  budget: z.object({
    monthly_jpy: z.number().positive(),
    fx_jpy_per_usd: z.number().positive(),
    warn_ratio: z.number().min(0).max(1),
    hard_stop_ratio: z.number().min(1),
  }),
  concurrency: z.object({
    global: z.number().int().positive(),
    per_engine: z.record(z.string(), z.number().int().positive()),
  }),
  retry: z.object({
    max_attempts: z.number().int().min(1),
    base_delay_ms: z.number().int().nonnegative(),
    timeout_ms: z.number().int().positive(),
  }),
  max_missing_rate: z.number().min(0).max(1),
});
export type MeasurementConfig = z.infer<typeof measurementConfigSchema>;

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const weekdayIndex = (d: Weekday) => WEEKDAYS.indexOf(d);

export const planSchema = z.object({
  label: z.string(),
  /** once = 単発（定期実行では計測せず、--clients を指定して手動で1回だけ実行する） */
  frequency: z.enum(["once", "monthly", "biweekly", "weekly"]),
  priority_frequency: z.enum(["none", "weekly", "twice_weekly"]),
  trials: z.number().int().min(1).max(20),
  engines: z.array(z.enum(ENGINE_NAMES)).min(1),
  max_competitors: z.number().int().min(0),
  question_set: z.enum(["trial", "all"]),
  paraphrases: z.boolean(),
  fact_keys: z.union([z.literal("all"), z.record(z.string(), z.array(z.string()))]),
  monthly_cost_cap_jpy: z.number().positive(),
  report: z.enum(["summary", "full"]),
  /** 人によるサポート（定例・訂正依頼の代行など）の有無。システムの計測内容には影響しない */
  human_support: z.boolean().default(false),
});
export type Plan = z.infer<typeof planSchema>;

export const plansConfigSchema = z.object({
  calendar: z.object({
    weekly_day: z.enum(WEEKDAYS),
    twice_weekly_days: z.array(z.enum(WEEKDAYS)).length(2),
    biweekly_day: z.enum(WEEKDAYS),
    monthly_day: z.number().int().min(1).max(28),
  }),
  plans: z.record(z.string(), planSchema),
});
export type PlansConfig = z.infer<typeof plansConfigSchema>;

const factKeySchema = z.object({
  type: z.enum(["string", "list", "date", "release", "text", "enum"]),
  label: z.string(),
  values: z.array(z.string()).optional(),
});
export type FactKeyDef = z.infer<typeof factKeySchema>;
/** 業界 → key → 定義 */
export const factKeysSchema = z.record(z.string(), z.record(z.string(), factKeySchema));
export type FactKeys = z.infer<typeof factKeysSchema>;

export type AppConfig = {
  engines: EnginesConfig;
  measurement: MeasurementConfig;
  plans: PlansConfig;
  factKeys: FactKeys;
  /** 実行条件の再現用。全 run にこのハッシュを紐付け、本文は config_snapshots に保存する */
  snapshotHash: string;
  snapshot: unknown;
};

export function loadConfig(dir = new URL("../config/", import.meta.url)): AppConfig {
  const read = (name: string) => parse(readFileSync(new URL(name, dir), "utf8"));
  const engines = enginesConfigSchema.parse(read("engines.yaml"));
  const measurement = measurementConfigSchema.parse(read("measurement.yaml"));
  const plans = plansConfigSchema.parse(read("plans.yaml"));
  const factKeys = factKeysSchema.parse(read("fact_keys.yaml"));
  for (const [ind, keys] of Object.entries(factKeys)) {
    for (const [k, def] of Object.entries(keys)) {
      if (def.type === "enum" && !def.values?.length) throw new Error(`fact_keys: ${ind}.${k} は enum なので values が必要です`);
    }
  }
  for (const [name, plan] of Object.entries(plans.plans)) {
    if (plan.fact_keys === "all") continue;
    for (const [ind, keys] of Object.entries(plan.fact_keys)) {
      for (const k of keys) if (!factKeys[ind]?.[k]) throw new Error(`plans: ${name} の fact_keys ${ind}.${k} が fact_keys.yaml にありません`);
    }
  }
  const snapshot = { engines, measurement, plans };
  const snapshotHash = createHash("sha256").update(stableStringify(snapshot)).digest("hex").slice(0, 16);
  return { engines, measurement, plans, factKeys, snapshot, snapshotHash };
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
