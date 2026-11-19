import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EntitiesFile, Question } from "../questions/index.ts";
import type { FactRecord } from "../facts.ts";
import type { AnalysisBatch, AnalysisResult, AnalysisTarget } from "../analysis/index.ts";
import { allocateByClient, batchCostSince, jstMonthStart, type MeasurementRecord, type ResponseRecord, type RunRecord, type Storage } from "./types.ts";

/**
 * DB 未設定でも計測を回せるローカル保存（JSONL 追記のみ）。
 * DATABASE_URL を設定すれば PostgresStorage に切り替わる。
 */
export class FileStorage implements Storage {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  private append(name: string, value: unknown) {
    appendFileSync(join(this.dir, name), `${JSON.stringify(value)}\n`);
  }

  private readLines<T>(name: string): T[] {
    const p = join(this.dir, name);
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
  }

  async syncDictionary(questions: Question[], entities: EntitiesFile) {
    writeFileSync(join(this.dir, "dictionary.json"), JSON.stringify({ questions, entities }, null, 2));
  }
  async saveConfigSnapshot(hash: string, snapshot: unknown) {
    const p = join(this.dir, `config-${hash}.json`);
    if (!existsSync(p)) writeFileSync(p, JSON.stringify(snapshot, null, 2));
  }
  async createMeasurement(m: MeasurementRecord) {
    this.append("measurements.jsonl", { event: "start", ...m });
  }
  async recordRun(run: RunRecord, response: ResponseRecord | null) {
    this.append("runs.jsonl", run);
    if (response) this.append("responses.jsonl", response);
  }
  async finishMeasurement(id: string, summary: unknown) {
    this.append("measurements.jsonl", { event: "finish", id, finishedAt: new Date().toISOString(), summary });
  }
  async monthToDateCostUsd(now: Date) {
    const start = jstMonthStart(now).getTime();
    return (
      this.readLines<RunRecord>("runs.jsonl")
        .filter((r) => Date.parse(r.executedAt) >= start)
        .reduce((s, r) => s + r.costUsd, 0) + batchCostSince(this.readLines<AnalysisBatch>("analysis_batches.jsonl"), now)
    );
  }
  async monthToDateCostUsdByClient(now: Date) {
    return allocateByClient(this.readLines<RunRecord>("runs.jsonl"), now, this.readLines<AnalysisBatch>("analysis_batches.jsonl"));
  }
  async listUnanalyzed(version: string, opts: { measurementId?: string; limit?: number } = {}): Promise<AnalysisTarget[]> {
    const done = new Set(
      this.readLines<AnalysisBatch>("analysis_batches.jsonl").filter((b) => b.version === version).flatMap((b) => b.runIds),
    );
    let runs = this.readLines<RunRecord>("runs.jsonl").filter(
      (r) => r.status === "ok" && !done.has(r.id) && (!opts.measurementId || r.measurementId === opts.measurementId),
    );
    if (opts.limit !== undefined) runs = runs.slice(0, opts.limit);
    const want = new Set(runs.map((r) => r.id));
    const responses = new Map(this.readLines<ResponseRecord>("responses.jsonl").filter((x) => want.has(x.runId)).map((x) => [x.runId, x]));
    return runs.filter((r) => responses.has(r.id)).map((run) => ({ run, response: responses.get(run.id)! }));
  }
  async saveAnalysis(result: AnalysisResult) {
    const v = result.batch.version;
    for (const m of result.mentions) this.append("mentions.jsonl", { ...m, analyzerVersion: v });
    for (const c of result.claims) this.append("claims.jsonl", { ...c, analyzerVersion: v });
    for (const c of result.citations) this.append("citations.jsonl", { ...c, analyzerVersion: v });
    // 実行記録は最後に書く（途中で落ちても未解析として再実行される）
    this.append("analysis_batches.jsonl", result.batch);
  }
  async insertFacts(facts: FactRecord[]) {
    for (const f of facts) this.append("facts.jsonl", f);
  }
  async listFacts() {
    return this.readLines<FactRecord>("facts.jsonl");
  }
  async close() {}
}
