import type { EnginesConfig } from "../config.ts";
import { type AskOptions, type Citation, type EngineClient, type EngineResult, dedupeCitations, postJson, requireEnv } from "./types.ts";

type Cfg = EnginesConfig["openai"];

// Responses API + web_search ツール
// https://developers.openai.com/api/docs/guides/tools-web-search
export class OpenAIEngine implements EngineClient {
  readonly name = "openai" as const;
  readonly model: string;
  private readonly cfg: Cfg;
  private readonly apiKey: string;

  constructor(cfg: Cfg, apiKey = requireEnv("OPENAI_API_KEY")) {
    this.cfg = cfg;
    this.model = cfg.model;
    this.apiKey = apiKey;
  }

  buildRequest(prompt: string, options: AskOptions = {}) {
    const fallback = this.cfg.service_tier === "flex" && options.preferReliability && this.cfg.flex_fallback_to_standard;
    return {
      model: this.cfg.model,
      input: prompt,
      tools: [
        {
          type: "web_search",
          search_context_size: this.cfg.web_search.search_context_size,
          ...(this.cfg.web_search.user_location ? { user_location: this.cfg.web_search.user_location } : {}),
        },
      ],
      include: ["web_search_call.action.sources"],
      service_tier: fallback ? "default" : this.cfg.service_tier,
    };
  }

  async ask(prompt: string, options: AskOptions = {}): Promise<EngineResult> {
    const request = this.buildRequest(prompt, options);
    const raw = await postJson("openai", "https://api.openai.com/v1/responses", { authorization: `Bearer ${this.apiKey}` }, request, options.signal);
    return { ...parseOpenAIResponse(raw), request };
  }
}

export function parseOpenAIResponse(raw: any): Omit<EngineResult, "request"> {
  const output: any[] = raw?.output ?? [];
  const texts: string[] = [];
  const citations: Citation[] = [];
  let searchCount = 0;
  for (const item of output) {
    if (item.type === "web_search_call" && (item.action?.type ?? "search") === "search") searchCount++;
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (part.type !== "output_text") continue;
        texts.push(part.text ?? "");
        for (const a of part.annotations ?? []) {
          if (a.type === "url_citation" && a.url) citations.push({ url: a.url, title: a.title });
        }
      }
    }
  }
  const u = raw?.usage ?? {};
  return {
    text: texts.join("\n"),
    citations: dedupeCitations(citations),
    model: raw?.model ?? "unknown",
    usage: {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      reasoningTokens: u.output_tokens_details?.reasoning_tokens,
      searchCount,
      discountedTier: raw?.service_tier === "flex",
    },
    raw,
  };
}
