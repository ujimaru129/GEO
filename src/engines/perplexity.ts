import type { EnginesConfig } from "../config.ts";
import { type AskOptions, type Citation, type EngineClient, type EngineResult, dedupeCitations, postJson, requireEnv } from "./types.ts";

type Cfg = EnginesConfig["perplexity"];

// Agent API（旧 Sonar Chat Completions の後継）
// https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to
export class PerplexityEngine implements EngineClient {
  readonly name = "perplexity" as const;
  readonly model: string;
  private readonly cfg: Cfg;
  private readonly apiKey: string;

  constructor(cfg: Cfg, apiKey = requireEnv("PERPLEXITY_API_KEY")) {
    this.cfg = cfg;
    this.model = cfg.model;
    this.apiKey = apiKey;
  }

  buildRequest(prompt: string) {
    return {
      model: this.cfg.model,
      input: prompt,
      tools: [
        {
          type: "web_search",
          search_type: this.cfg.web_search.search_type,
          ...(this.cfg.web_search.user_location ? { user_location: this.cfg.web_search.user_location } : {}),
        },
      ],
    };
  }

  async ask(prompt: string, options: AskOptions = {}): Promise<EngineResult> {
    const request = this.buildRequest(prompt);
    const raw = await postJson("perplexity", "https://api.perplexity.ai/v1/agent", { authorization: `Bearer ${this.apiKey}` }, request, options.signal);
    return { ...parsePerplexityResponse(raw), request };
  }
}

export function parsePerplexityResponse(raw: any): Omit<EngineResult, "request"> {
  const output: any[] = raw?.output ?? [];
  const texts: string[] = [];
  const results = new Map<number, Citation>();
  let searchCount = 0;
  for (const item of output) {
    if (item.type === "search_results") {
      searchCount++;
      for (const r of item.results ?? []) if (r.url && typeof r.id === "number") results.set(r.id, { url: r.url, title: r.title });
    }
    if (item.type === "message") {
      for (const part of item.content ?? []) if (part.type === "output_text") texts.push(part.text ?? "");
    }
  }
  const text = texts.join("\n") || raw?.output_text || "";
  // 本文の [n] / [web:n] が search_results の id に対応する。引用がなければ検索結果全体を記録する。
  const cited = [...text.matchAll(/\[(?:web:)?(\d+)\]/g)].map((m) => results.get(Number(m[1]))).filter((c): c is Citation => !!c);
  const u = raw?.usage ?? {};
  return {
    text,
    citations: dedupeCitations(cited.length ? cited : [...results.values()]),
    model: raw?.model ?? "unknown",
    usage: {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      reasoningTokens: u.output_tokens_details?.reasoning_tokens || undefined,
      searchCount,
      reportedTokenCostUsd: typeof u.cost?.total_cost === "number" ? u.cost.total_cost : undefined,
    },
    raw,
  };
}
