import type { AppConfig } from "../config.ts";
import type { FactRecord } from "../facts.ts";
import { jstCalendar } from "../plans.ts";
import type { EntitiesFile, Question } from "../questions/index.ts";
import { RetryExhaustedError, withRetry } from "../runner/retry.ts";
import type { SourceType, Verdict } from "../report/types.ts";
import type { ResponseRecord, RunRecord } from "../storage/types.ts";
import { classifyCitations, officialDomainsOf } from "./citations.ts";
import { type ClaimJudge, factsForJudge } from "./claims.ts";
import { detectMentions } from "./mentions.ts";

export type MentionRow = { runId: string; entityId: string; rank: number; method: "rule" | "llm" };
export type ClaimRow = {
  runId: string;
  entityId: string;
  factKey: string;
  claimJson: { statement: string; normalized: string };
  verdict: Verdict;
  confidence: number;
  evidence: string;
};
export type CitationRow = { runId: string; url: string; domain: string; sourceType: SourceType };

export type AnalysisBatch = {
  id: string;
  measurementId: string | null;
  version: string;
  startedAt: string;
  finishedAt: string;
  /** 解析した run（言及・判定・引用が0件でも解析済みとして記録する） */
  runIds: string[];
  llmCalls: number;
  llmFailed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costJpy: number;
  /** 判定の費用の按分（顧客ID → USD）。計測と同じく社内の原価把握用 */
  costAllocation: Record<string, number>;
  model: string | null;
};

export type AnalysisResult = {
  batch: AnalysisBatch;
  mentions: MentionRow[];
  claims: ClaimRow[];
  citations: CitationRow[];
  /** LLM の判定に失敗した run。解析済みにしないので、次回また対象になる */
  failedRunIds: string[];
};

export type AnalysisTarget = { run: RunRecord; response: ResponseRecord };

export type AnalyzeOptions = {
  config: AppConfig;
  entities: EntitiesFile;
  facts: FactRecord[];
  questions: Question[];
  /** null なら正誤の判定をせず、言及と引用元だけ（費用なし） */
  judge: ClaimJudge | null;
  measurementId?: string | null;
  log?: (msg: string) => void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

/** 判定の対象にする項目: 質問の fact_keys のうち、対象の顧客のプランで扱う項目 */
export function judgeKeys(q: Question | undefined, industry: string, clientPlanKeys: "all" | Record<string, string[]>): string[] {
  if (!q || q.fact_keys.length === 0) return [];
  if (clientPlanKeys === "all") return q.fact_keys;
  const allowed = new Set(clientPlanKeys[industry] ?? []);
  return q.fact_keys.filter((k) => allowed.has(k));
}

export function planAnalysis(targets: AnalysisTarget[], opts: Pick<AnalyzeOptions, "config" | "entities" | "facts" | "questions">) {
  const qById = new Map(opts.questions.map((q) => [q.id, q]));
  const entityById = new Map(opts.entities.entities.map((e) => [e.id, e]));
  const planOf = new Map(opts.entities.clients.map((c) => [c.id, opts.config.plans.plans[c.plan]]));
  const official = officialDomainsOf(opts.entities.entities);
  return targets.map(({ run, response }) => {
    const q = qById.get(run.questionId);
    const industry = q?.industry ?? entityById.get(run.entityId ?? "")?.industry ?? "";
    const candidates = opts.entities.entities.filter((e) => e.industry === industry);
    const mentions = detectMentions(response.text, candidates, run.entityId);
    const citations = classifyCitations(response.citations ?? [], official, opts.config.analysis.source_domains);
    const subject = run.entityId ? entityById.get(run.entityId) : undefined;
    let judgeInput = null;
    if (subject && mentions.some((m) => m.entityId === subject.id)) {
      const plan = planOf.get(subject.client_id);
      const keys = plan ? judgeKeys(q, subject.industry, plan.fact_keys) : [];
      const date = jstCalendar(new Date(run.executedAt)).ymd;
      const facts = factsForJudge(opts.facts, subject.id, keys, opts.config.factKeys[subject.industry] ?? {}, date);
      if (facts.length) {
        judgeInput = {
          entityId: subject.id,
          input: { entityName: subject.official_name, aliases: subject.aliases, date, question: run.promptText, answer: response.text, facts },
        };
      }
    }
    return { run, mentions, citations, judgeInput };
  });
}

/**
 * 回答の解析（フェーズB）。
 * 1. 言及: 回答に出てきた計測対象・競合（ルール、費用なし）
 * 2. 引用元: ドメインと種類（公式・メディア・wiki・SNS・EC・その他）（ルール、費用なし）
 * 3. 正誤: 質問の主題について、正解データと照合（小型 LLM。主題が回答に出てきて、正解データがある場合だけ）
 */
export async function analyzeRuns(targets: AnalysisTarget[], opts: AnalyzeOptions): Promise<AnalysisResult> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => {});
  const { analysis, measurement } = opts.config;
  const startedAt = now().toISOString();
  const planned = planAnalysis(targets, opts);

  const mentions: MentionRow[] = [];
  const citations: CitationRow[] = [];
  const claims: ClaimRow[] = [];
  const failedRunIds: string[] = [];
  const allocation: Record<string, number> = {};
  let llmCalls = 0;
  let llmFailed = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let model: string | null = null;

  for (const p of planned) {
    for (const m of p.mentions) mentions.push({ runId: p.run.id, entityId: m.entityId, rank: m.rank, method: "rule" });
    for (const c of p.citations) citations.push({ runId: p.run.id, ...c });
  }

  const jobs = opts.judge ? planned.filter((p) => p.judgeInput) : [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const p = jobs[next++];
      const ji = p.judgeInput!;
      llmCalls++;
      try {
        const { value } = await withRetry(
          (_attempt, isLast) =>
            opts.judge!.judge(ji.input, { signal: AbortSignal.timeout(analysis.llm.timeout_ms), preferReliability: isLast && analysis.llm.max_attempts > 1 }),
          { maxAttempts: analysis.llm.max_attempts, baseDelayMs: 2000, sleep: opts.sleep },
        );
        model = value.model;
        inputTokens += value.inputTokens;
        outputTokens += value.outputTokens;
        costUsd += value.costUsd;
        for (const [c, share] of Object.entries(p.run.costAllocation ?? {})) allocation[c] = (allocation[c] ?? 0) + value.costUsd * share;
        for (const c of value.claims) {
          claims.push({
            runId: p.run.id, entityId: ji.entityId, factKey: c.factKey, claimJson: { statement: c.statement, normalized: c.normalized },
            verdict: c.verdict, confidence: c.confidence, evidence: c.evidence,
          });
        }
      } catch (err) {
        llmFailed++;
        failedRunIds.push(p.run.id);
        const e = err instanceof RetryExhaustedError ? err.lastError : err;
        log(`[判定失敗] ${p.run.promptKey} ${p.run.engine} #${p.run.trialNo}: ${e instanceof Error ? e.message : String(e)}`);
      }
      done++;
      if (done % 50 === 0) log(`[進捗] 判定 ${done}/${jobs.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(analysis.llm.concurrency, jobs.length) }, worker));

  const failed = new Set(failedRunIds);
  // 判定に失敗した run は、言及・引用も保存しない（次回まとめてやり直す）
  const keep = <T extends { runId: string }>(rows: T[]) => rows.filter((r) => !failed.has(r.runId));
  return {
    batch: {
      id: `${analysis.version}-${startedAt.replace(/[:.]/g, "-")}`,
      measurementId: opts.measurementId ?? null,
      version: analysis.version,
      startedAt,
      finishedAt: now().toISOString(),
      runIds: targets.map((t) => t.run.id).filter((id) => !failed.has(id)),
      llmCalls,
      llmFailed,
      inputTokens,
      outputTokens,
      costUsd,
      costJpy: costUsd * measurement.budget.fx_jpy_per_usd,
      costAllocation: allocation,
      model,
    },
    mentions: keep(mentions),
    claims: keep(claims),
    citations: keep(citations),
    failedRunIds,
  };
}
