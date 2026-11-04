import type { EngineName } from "../config.ts";
import type { Citation } from "../engines/types.ts";
import type { FactRecord } from "../facts.ts";
import type { EntitiesFile, Question } from "../questions/index.ts";

export type RunStatus = "ok" | "failed" | "skipped_budget";

export type RunRecord = {
  id: string;
  measurementId: string;
  promptKey: string;
  questionId: string;
  entityId: string | null;
  competitorId: string | null;
  variant: number;
  /** 条件の変数に入れた値（例: { region: "渋谷" }） */
  context: Record<string, string>;
  promptText: string;
  engine: EngineName;
  model: string | null;
  trialNo: number;
  executedAt: string;
  status: RunStatus;
  attempts: number;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  searchCount: number | null;
  costUsd: number;
  costJpy: number;
  /** 費用の按分（顧客ID → 割合。合計1）。発見カテゴリは同じ業界の顧客で共有するため複数になる */
  costAllocation: Record<string, number>;
  error: string | null;
  configHash: string;
};

export type ResponseRecord = {
  runId: string;
  text: string;
  citations: Citation[];
  request: unknown;
  raw: unknown;
};

export type MeasurementRecord = {
  id: string;
  scope: string;
  startedAt: string;
  configHash: string;
  plannedCalls: number;
  estimatedUsd: number;
};

export interface Storage {
  syncDictionary(questions: Question[], entities: EntitiesFile): Promise<void>;
  saveConfigSnapshot(hash: string, snapshot: unknown): Promise<void>;
  createMeasurement(m: MeasurementRecord): Promise<void>;
  /** 生データの保存。追記のみで上書きしない */
  recordRun(run: RunRecord, response: ResponseRecord | null): Promise<void>;
  finishMeasurement(id: string, summary: unknown): Promise<void>;
  /** 当月（日本時間）の確定費用 */
  monthToDateCostUsd(now: Date): Promise<number>;
  /** 当月（日本時間）の顧客別の按分後費用 */
  monthToDateCostUsdByClient(now: Date): Promise<Record<string, number>>;
  /** 正解データの追加（上書きしない） */
  insertFacts(facts: FactRecord[]): Promise<void>;
  /** 正解データの全バージョン */
  listFacts(): Promise<FactRecord[]>;
  close(): Promise<void>;
}

/** 日本時間での月初（UTC の Date） */
export function jstMonthStart(now: Date): Date {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - 9 * 3600_000);
}

export function allocateByClient(runs: Pick<RunRecord, "executedAt" | "costUsd" | "costAllocation">[], now: Date) {
  const start = jstMonthStart(now).getTime();
  const out: Record<string, number> = {};
  for (const r of runs) {
    if (Date.parse(r.executedAt) < start) continue;
    for (const [c, share] of Object.entries(r.costAllocation ?? {})) out[c] = (out[c] ?? 0) + r.costUsd * share;
  }
  return out;
}
