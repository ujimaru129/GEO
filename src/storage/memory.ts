import type { EntitiesFile, Question } from "../questions/index.ts";
import { jstMonthStart, type MeasurementRecord, type ResponseRecord, type RunRecord, type Storage } from "./types.ts";

export class MemoryStorage implements Storage {
  questions: Question[] = [];
  entities: EntitiesFile | null = null;
  snapshots = new Map<string, unknown>();
  measurements = new Map<string, MeasurementRecord & { summary?: unknown }>();
  runs: RunRecord[] = [];
  responses = new Map<string, ResponseRecord>();
  /** テスト用: 当月の既存費用 */
  baseMonthCostUsd = 0;

  async syncDictionary(questions: Question[], entities: EntitiesFile) {
    this.questions = questions;
    this.entities = entities;
  }
  async saveConfigSnapshot(hash: string, snapshot: unknown) {
    this.snapshots.set(hash, snapshot);
  }
  async createMeasurement(m: MeasurementRecord) {
    this.measurements.set(m.id, { ...m });
  }
  async recordRun(run: RunRecord, response: ResponseRecord | null) {
    const dup = this.runs.find(
      (r) => r.measurementId === run.measurementId && r.promptKey === run.promptKey && r.engine === run.engine && r.trialNo === run.trialNo,
    );
    if (dup) throw new Error(`run は上書きできません: ${run.promptKey} ${run.engine} #${run.trialNo}`);
    this.runs.push(run);
    if (response) this.responses.set(run.id, response);
  }
  async finishMeasurement(id: string, summary: unknown) {
    const m = this.measurements.get(id);
    if (m) m.summary = summary;
  }
  async monthToDateCostUsd(now: Date) {
    const start = jstMonthStart(now).getTime();
    return this.baseMonthCostUsd + this.runs.filter((r) => Date.parse(r.executedAt) >= start).reduce((s, r) => s + r.costUsd, 0);
  }
  async close() {}
}
