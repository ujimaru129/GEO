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
  trials: z.number().int().min(1).max(20),
  schedule: z.record(z.string(), z.string()),
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

export type AppConfig = {
  engines: EnginesConfig;
  measurement: MeasurementConfig;
  /** 実行条件の再現用。全 run にこのハッシュを紐付け、本文は config_snapshots に保存する */
  snapshotHash: string;
  snapshot: unknown;
};

export function loadConfig(dir = new URL("../config/", import.meta.url)): AppConfig {
  const read = (name: string) => parse(readFileSync(new URL(name, dir), "utf8"));
  const engines = enginesConfigSchema.parse(read("engines.yaml"));
  const measurement = measurementConfigSchema.parse(read("measurement.yaml"));
  const snapshot = { engines, measurement };
  const snapshotHash = createHash("sha256").update(stableStringify(snapshot)).digest("hex").slice(0, 16);
  return { engines, measurement, snapshot, snapshotHash };
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
