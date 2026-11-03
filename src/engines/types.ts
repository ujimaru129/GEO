import type { EngineName } from "../config.ts";

export type Citation = { url: string; title?: string };

export type EngineUsage = {
  inputTokens: number;
  outputTokens: number;
  /** 出力に含まれる思考トークン（内訳。outputTokens に含まれている） */
  reasoningTokens?: number;
  /** 課金対象の検索回数（OpenAI: search 呼び出し / Gemini: 検索クエリ / Perplexity, Claude: 検索回数） */
  searchCount: number;
  /** API が返したトークン代の実費（Perplexity の usage.cost.total_cost）。検索料金は含まない */
  reportedTokenCostUsd?: number;
  /** 割引料金で処理されたか（OpenAI flex） */
  discountedTier?: boolean;
};

export type EngineResult = {
  text: string;
  citations: Citation[];
  /** API が返した正式なモデル名 */
  model: string;
  usage: EngineUsage;
  /** 実際に送ったリクエスト本文（APIキーは含めない） */
  request: unknown;
  raw: unknown;
};

export type AskOptions = {
  signal?: AbortSignal;
  /** リトライの最終試行など、割引ティアを使わず確実に通したいとき */
  preferReliability?: boolean;
};

export interface EngineClient {
  readonly name: EngineName;
  readonly model: string;
  ask(prompt: string, options?: AskOptions): Promise<EngineResult>;
}

/** HTTP エラー。status と retryable で再試行の可否を判断する */
export class EngineHttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly body: string;
  constructor(engine: string, status: number, body: string, retryAfterMs?: number) {
    super(`${engine} HTTP ${status}: ${body.slice(0, 500)}`);
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
    this.retryable = status === 408 || status === 409 || status === 429 || status >= 500;
  }
}

export async function postJson(
  engine: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    const ra = res.headers.get("retry-after");
    const retryAfterMs = ra && !Number.isNaN(Number(ra)) ? Number(ra) * 1000 : undefined;
    throw new EngineHttpError(engine, res.status, text, retryAfterMs);
  }
  return JSON.parse(text);
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が設定されていません`);
  return v;
}

export function dedupeCitations(list: Citation[]): Citation[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}
