import type { EnginesConfig } from "../config.ts";
import { type AskOptions, type Citation, type EngineClient, type EngineResult, dedupeCitations, postJson, requireEnv } from "./types.ts";

type Cfg = EnginesConfig["claude"];

// Messages API + web search ツール
// https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
export class ClaudeEngine implements EngineClient {
  readonly name = "claude" as const;
  readonly model: string;
  private readonly cfg: Cfg;
  private readonly apiKey: string;

  constructor(cfg: Cfg, apiKey = requireEnv("ANTHROPIC_API_KEY")) {
    this.cfg = cfg;
    this.model = cfg.model;
    this.apiKey = apiKey;
  }

  buildRequest(prompt: string) {
    const ws = this.cfg.web_search;
    return {
      model: this.cfg.model,
      max_tokens: this.cfg.max_tokens,
      messages: [{ role: "user", content: prompt }],
      tools: [
        {
          type: ws.tool_type,
          name: "web_search",
          ...(ws.max_uses ? { max_uses: ws.max_uses } : {}),
          ...(ws.user_location ? { user_location: ws.user_location } : {}),
        },
      ],
    };
  }

  async ask(prompt: string, options: AskOptions = {}): Promise<EngineResult> {
    const request = this.buildRequest(prompt);
    const raw = await postJson(
      "claude",
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      request,
      options.signal,
    );
    return { ...parseClaudeResponse(raw), request };
  }
}

export function parseClaudeResponse(raw: any): Omit<EngineResult, "request"> {
  const blocks: any[] = raw?.content ?? [];
  const texts: string[] = [];
  const citations: Citation[] = [];
  for (const b of blocks) {
    if (b.type !== "text") continue;
    texts.push(b.text ?? "");
    for (const c of b.citations ?? []) {
      if (c.type === "web_search_result_location" && c.url) citations.push({ url: c.url, title: c.title });
    }
  }
  const u = raw?.usage ?? {};
  return {
    text: texts.join(""),
    citations: dedupeCitations(citations),
    model: raw?.model ?? "unknown",
    usage: {
      inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
      searchCount: u.server_tool_use?.web_search_requests ?? 0,
    },
    raw,
  };
}
