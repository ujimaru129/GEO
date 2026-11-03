import type { EngineName, EnginesConfig } from "../config.ts";
import { ClaudeEngine } from "./claude.ts";
import { GeminiEngine } from "./gemini.ts";
import { OpenAIEngine } from "./openai.ts";
import { PerplexityEngine } from "./perplexity.ts";
import type { EngineClient } from "./types.ts";

export function createEngines(cfg: EnginesConfig, only?: EngineName[]): EngineClient[] {
  const want = (n: EngineName) => cfg[n].enabled && (!only || only.includes(n));
  const engines: EngineClient[] = [];
  if (want("openai")) engines.push(new OpenAIEngine(cfg.openai));
  if (want("gemini")) engines.push(new GeminiEngine(cfg.gemini));
  if (want("perplexity")) engines.push(new PerplexityEngine(cfg.perplexity));
  if (want("claude")) engines.push(new ClaudeEngine(cfg.claude));
  return engines;
}
