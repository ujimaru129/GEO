import type { EnginesConfig } from "../config.ts";
import { type AskOptions, type Citation, type EngineClient, type EngineResult, dedupeCitations, postJson, requireEnv } from "./types.ts";

type Cfg = EnginesConfig["gemini"];

// Gemini API generateContent + Grounding with Google Search
// 公式ドキュメント（ai.google.dev）は環境の通信制限で未確認。実キーでの疎通時にレスポンス形式を確認すること。
export class GeminiEngine implements EngineClient {
  readonly name = "gemini" as const;
  readonly model: string;
  private readonly apiKey: string;

  constructor(cfg: Cfg, apiKey = requireEnv("GEMINI_API_KEY")) {
    this.model = cfg.model;
    this.apiKey = apiKey;
  }

  buildRequest(prompt: string) {
    return {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
    };
  }

  async ask(prompt: string, options: AskOptions = {}): Promise<EngineResult> {
    const request = this.buildRequest(prompt);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const raw = await postJson("gemini", url, { "x-goog-api-key": this.apiKey }, request, options.signal);
    return { ...parseGeminiResponse(raw, this.model), request };
  }
}

export function parseGeminiResponse(raw: any, requestedModel: string): Omit<EngineResult, "request"> {
  const cand = raw?.candidates?.[0] ?? {};
  const text = (cand.content?.parts ?? [])
    .filter((p: any) => typeof p.text === "string" && !p.thought)
    .map((p: any) => p.text)
    .join("");
  const gm = cand.groundingMetadata ?? {};
  // groundingChunks の uri は Google のリダイレクトURL。title に元ドメインが入るため両方保存する。
  const citations: Citation[] = (gm.groundingChunks ?? [])
    .map((c: any) => c.web)
    .filter((w: any) => w?.uri)
    .map((w: any) => ({ url: w.uri, title: w.title }));
  const u = raw?.usageMetadata ?? {};
  const thoughts = u.thoughtsTokenCount ?? 0;
  return {
    text,
    citations: dedupeCitations(citations),
    model: raw?.modelVersion ?? requestedModel,
    usage: {
      // 検索由来の入力（toolUsePromptTokenCount）は無料なので含めない
      inputTokens: u.promptTokenCount ?? 0,
      outputTokens: (u.candidatesTokenCount ?? 0) + thoughts,
      reasoningTokens: thoughts || undefined,
      searchCount: (gm.webSearchQueries ?? []).length,
    },
    raw,
  };
}
