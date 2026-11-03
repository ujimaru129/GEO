import type { EngineName } from "../config.ts";
import type { Citation } from "../engines/types.ts";
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
  close(): Promise<void>;
}

/** 日本時間での月初（UTC の Date） */
export function jstMonthStart(now: Date): Date {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - 9 * 3600_000);
}
