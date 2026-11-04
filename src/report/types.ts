import type { EngineName } from "../config.ts";
import type { FactRecord } from "../facts.ts";
import type { FactRequest, FactSubmission } from "../workflow/fact-requests.ts";

export type Verdict = "correct" | "incorrect" | "outdated" | "unverifiable";
export type SourceType = "official" | "media" | "wiki" | "sns" | "ec" | "other";

export const ENGINE_LABEL: Record<EngineName, string> = {
  openai: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
  claude: "Claude",
};

export const SOURCE_LABEL: Record<SourceType, string> = {
  official: "公式",
  media: "メディア",
  wiki: "wiki",
  sns: "SNS",
  ec: "EC",
  other: "その他",
};

export type ReportClient = {
  id: string;
  name: string;
  plan: string;
  planLabel: string;
  industry: string;
  /** config/industries.yaml の業態の言い回し */
  industryLabel: string;
  subject: string;
  noun: string;
  counter: string;
  report: "summary" | "full";
  humanSupport: boolean;
  trials: number;
};

export type REntity = { id: string; name: string; role: "target" | "competitor" };

export type RRun = {
  id: string;
  measurementId: string;
  questionId: string;
  category: "discovery" | "entity" | "comparison" | "recency";
  engine: EngineName;
  executedAt: string;
  status: "ok" | "failed" | "skipped_budget";
  entityId: string | null;
  costJpy: number;
  /** 条件の変数に入れた値（例: { region: "渋谷" }）。条件なしは {} */
  context: Record<string, string>;
};

export type RMention = { runId: string; entityId: string; rank: number | null };

export type RClaim = {
  id: string;
  runId: string;
  entityId: string;
  factKey: string;
  /** AI の主張を短く言い直したもの（例: メンバーは5人） */
  statement: string;
  /** 同じ主張をまとめるためのキー */
  normalized: string;
  verdict: Verdict;
  confidence: number;
  /** 回答文の該当箇所 */
  evidence: string;
};

export type RReview = { claimId: string; decision: Verdict; reviewer: string; reviewerName: string; reviewedAt: string; note: string | null };

export type RCitation = { runId: string; url: string; domain: string; sourceType: SourceType };

export type AdviceItem = {
  priority: "high" | "mid" | "low";
  action: string;
  reason: string;
  effort: "small" | "mid" | "large";
  /** そのまま使える文面（訂正依頼文・サイト掲載文など） */
  draft?: string;
};

export type RAdvice = {
  id: string;
  clientId: string;
  measurementId: string;
  createdAt: string;
  items: AdviceItem[];
  /** Pro の担当者コメント */
  comment: string | null;
  status: "draft" | "approved";
  approvedBy: string | null;
  approvedAt: string | null;
};

export type ReportRows = {
  client: ReportClient;
  target: REntity;
  competitors: REntity[];
  runs: RRun[];
  mentions: RMention[];
  claims: RClaim[];
  reviews: RReview[];
  citations: RCitation[];
  facts: FactRecord[];
  factLabels: Record<string, string>;
  advice: RAdvice[];
  requests: FactRequest[];
  submissions: FactSubmission[];
};
