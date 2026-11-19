import type { AnalysisConfig, FactKeyDef } from "../config.ts";
import { isFlexUnavailable, postJson, requireEnv } from "../engines/types.ts";
import { currentFacts, type FactRecord, factAt } from "../facts.ts";
import { formatFactValue } from "../report/compute.ts";
import type { Verdict } from "../report/types.ts";

export const VERDICTS = ["correct", "incorrect", "outdated", "unverifiable"] as const satisfies readonly Verdict[];

/** 判定に渡す正解データ（1項目） */
export type FactForJudge = {
  key: string;
  label: string;
  type: FactKeyDef["type"];
  /** 回答日時点の正解。未登録・未公表なら null */
  current: string | null;
  /** 回答日より前に終わった過去の正解（古い情報の判定用） */
  past: { value: string; validFrom: string | null; validTo: string }[];
};

export type JudgeInput = {
  entityName: string;
  aliases: string[];
  /** 回答日（日本時間 YYYY-MM-DD） */
  date: string;
  question: string;
  answer: string;
  facts: FactForJudge[];
};

export type JudgedClaim = {
  factKey: string;
  statement: string;
  normalized: string;
  verdict: Verdict;
  confidence: number;
  evidence: string;
};

export type JudgeResult = {
  claims: JudgedClaim[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export interface ClaimJudge {
  judge(input: JudgeInput, opts?: { signal?: AbortSignal; preferReliability?: boolean }): Promise<JudgeResult>;
}

/** 回答日時点の正解と、それ以前の正解（履歴）を集める。公表日前の情報は使わない */
export function factsForJudge(
  facts: FactRecord[],
  entityId: string,
  keys: string[],
  defs: Record<string, FactKeyDef>,
  date: string,
): FactForJudge[] {
  const all = currentFacts(facts).filter((f) => f.entityId === entityId);
  const out: FactForJudge[] = [];
  for (const key of keys) {
    const def = defs[key];
    if (!def) continue;
    const cur = factAt(facts, entityId, key, date);
    const past = all
      .filter((f) => f.key === key && f.validTo !== null && f.validTo < date && (f.publicFrom === null || f.publicFrom <= date))
      .sort((a, b) => (a.validTo! < b.validTo! ? 1 : -1))
      .map((f) => ({ value: formatFactValue(f.value), validFrom: f.validFrom, validTo: f.validTo! }));
    if (!cur && past.length === 0) continue;
    out.push({ key, label: def.label, type: def.type, current: cur ? formatFactValue(cur.value) : null, past });
  }
  return out;
}

const squash = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");

/**
 * LLM の出力を検証して整える。
 * - 渡していない項目・回答文に無い引用（evidence）の主張は捨てる（LLM の作り話を載せない）
 * - 確信度が低いもの、現在の正解が無いのに「正しい/誤り」としたものは「照合不能」にする
 */
export function sanitizeClaims(raw: unknown, input: JudgeInput, minConfidence: number): JudgedClaim[] {
  const list = (raw as { claims?: unknown[] })?.claims;
  if (!Array.isArray(list)) return [];
  const byKey = new Map(input.facts.map((f) => [f.key, f]));
  const answer = squash(input.answer);
  const out: JudgedClaim[] = [];
  const seen = new Set<string>();
  for (const c of list as Record<string, unknown>[]) {
    const fact = byKey.get(String(c?.fact_key ?? ""));
    const evidence = String(c?.evidence ?? "").trim();
    const statement = String(c?.statement ?? "").trim();
    if (!fact || !evidence || !statement || !answer.includes(squash(evidence))) continue;
    let verdict = (VERDICTS as readonly string[]).includes(String(c.verdict)) ? (c.verdict as Verdict) : "unverifiable";
    const confidence = Math.min(1, Math.max(0, Number(c.confidence) || 0));
    if (confidence < minConfidence) verdict = "unverifiable";
    if (fact.current === null && (verdict === "correct" || verdict === "incorrect")) verdict = "unverifiable";
    if (verdict === "outdated" && fact.past.length === 0) verdict = fact.current === null ? "unverifiable" : "incorrect";
    const normalized = String(c.normalized ?? "").trim().toLowerCase() || statement;
    const dedupe = `${fact.key}|${normalized}|${verdict}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ factKey: fact.key, statement: statement.slice(0, 200), normalized: normalized.slice(0, 120), verdict, confidence, evidence: evidence.slice(0, 300) });
  }
  return out;
}

const INSTRUCTIONS = `あなたは事実確認の担当者です。AIアシスタントの回答から、指定された対象についての「指定された項目」に関する主張だけを抜き出し、正解データと照合してください。

ルール:
- 回答に書かれていない項目は出力しない。推測で補わない。
- 同名の別の人物・作品・会社についての記述は対象外。
- evidence: 回答文からそのまま抜き出した連続する一節（言い換え・要約は禁止。120字以内）。
- statement: 主張を短く言い直したもの（例: 「メンバーは5人（田中りんを含む）」）。
- normalized: 同じ内容の主張が同じ文字列になる短い識別子（英小文字・数字・ハイフン。例: members-5-incl-tanaka）。
- verdict:
  - correct: 回答日時点の正解（current）と一致する。一覧の項目は、挙げた要素がすべて現在の正解に含まれていれば一部だけでも correct。
  - outdated: 過去の正解（past）と一致し、現在の正解とは異なる（例: 卒業したメンバーを現メンバーとして挙げる、前作を最新作とする）。
  - incorrect: 現在の正解とも過去の正解とも一致しない。
  - unverifiable: 正解データでは判断できない。
- confidence: 判定の確からしさ（0〜1）。
- 該当する主張が無ければ claims は空配列。`;

export function claimsSchema(keys: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["claims"],
    properties: {
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fact_key", "statement", "normalized", "verdict", "confidence", "evidence"],
          properties: {
            fact_key: { type: "string", enum: keys },
            statement: { type: "string" },
            normalized: { type: "string" },
            verdict: { type: "string", enum: [...VERDICTS] },
            confidence: { type: "number" },
            evidence: { type: "string" },
          },
        },
      },
    },
  };
}

/** OpenAI Responses API（構造化出力）で判定する。Web検索は使わない */
export class OpenAIClaimJudge implements ClaimJudge {
  private readonly cfg: AnalysisConfig;
  private readonly apiKey: string;

  constructor(cfg: AnalysisConfig, apiKey = requireEnv("OPENAI_API_KEY")) {
    this.cfg = cfg;
    this.apiKey = apiKey;
  }

  buildRequest(input: JudgeInput, preferReliability = false) {
    const { llm } = this.cfg;
    const payload = {
      対象: input.entityName,
      別名: input.aliases,
      回答日: input.date,
      質問: input.question,
      正解データ: input.facts.map((f) => ({ fact_key: f.key, 項目: f.label, current: f.current, past: f.past })),
    };
    return {
      model: llm.model,
      instructions: INSTRUCTIONS,
      input: `${JSON.stringify(payload, null, 1)}\n\n--- 回答 ---\n${input.answer}`,
      text: { format: { type: "json_schema", name: "claims", strict: true, schema: claimsSchema(input.facts.map((f) => f.key)) } },
      service_tier: llm.service_tier === "flex" && !preferReliability ? "flex" : "default",
      store: false,
    };
  }

  async judge(input: JudgeInput, opts: { signal?: AbortSignal; preferReliability?: boolean } = {}): Promise<JudgeResult> {
    const post = (req: unknown) => postJson("analyzer", "https://api.openai.com/v1/responses", { authorization: `Bearer ${this.apiKey}` }, req, opts.signal);
    const request = this.buildRequest(input, opts.preferReliability);
    let raw: any;
    try {
      raw = await post(request);
    } catch (err) {
      // flex が混雑で使えないときは待たずに通常料金で出し直す（Retry-After が数分になることがある）
      if (!(isFlexUnavailable(err) && request.service_tier === "flex")) throw err;
      raw = await post(this.buildRequest(input, true));
    }
    const text = (raw?.output ?? [])
      .filter((o: any) => o.type === "message")
      .flatMap((o: any) => o.content ?? [])
      .filter((p: any) => p.type === "output_text")
      .map((p: any) => p.text)
      .join("");
    const u = raw?.usage ?? {};
    const p = this.cfg.llm.pricing;
    const mult = raw?.service_tier === "flex" ? p.flex_token_multiplier : 1;
    const inputTokens = u.input_tokens ?? 0;
    const outputTokens = u.output_tokens ?? 0;
    return {
      claims: sanitizeClaims(JSON.parse(text || "{}"), input, this.cfg.min_confidence),
      model: raw?.model ?? this.cfg.llm.model,
      inputTokens,
      outputTokens,
      costUsd: ((inputTokens * p.input_per_mtok + outputTokens * p.output_per_mtok) / 1e6) * mult,
    };
  }
}
