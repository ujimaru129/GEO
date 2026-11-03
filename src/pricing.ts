import type { EngineName, EnginePricing, EnginesConfig } from "./config.ts";
import type { EngineUsage } from "./engines/types.ts";

export type CostBreakdown = { tokenUsd: number; searchUsd: number; totalUsd: number };

/**
 * 1回の実行の費用。月間無料枠（Gemini の検索5,000回）は実行単位では差し引かず、
 * 月次集計で控除する（保守的に見積もるため）。
 */
export function computeCost(pricing: EnginePricing, usage: EngineUsage): CostBreakdown {
  const multiplier = usage.discountedTier ? pricing.flex_token_multiplier : 1;
  const tokenUsd =
    usage.reportedTokenCostUsd ??
    ((usage.inputTokens * pricing.input_per_mtok + usage.outputTokens * pricing.output_per_mtok) / 1e6) * multiplier;
  const searchUsd = (usage.searchCount * pricing.search_per_1k) / 1000;
  return { tokenUsd, searchUsd, totalUsd: tokenUsd + searchUsd };
}

/** 実行前の見積もりに使う1回あたりの想定使用量（scripts/estimate-budget.ts の base 前提と同じ） */
export const ESTIMATE_USAGE: Record<EngineName, EngineUsage> = {
  openai: { inputTokens: 8100, outputTokens: 2500, searchCount: 2, discountedTier: true },
  gemini: { inputTokens: 100, outputTokens: 2500, searchCount: 2 },
  perplexity: { inputTokens: 6100, outputTokens: 2500, searchCount: 2 },
  claude: { inputTokens: 20100, outputTokens: 2500, searchCount: 2 },
};

export function estimateCallUsd(engines: EnginesConfig, engine: EngineName): number {
  return computeCost(engines[engine].pricing, ESTIMATE_USAGE[engine]).totalUsd;
}
