import type { EngineName } from "../config.ts";
import { EngineHttpError, type AskOptions, type EngineClient, type EngineResult } from "./types.ts";

/**
 * 課金なしで計測の流れを確認するためのエンジン（--mock / テスト用）。
 * failRate で一時エラーを発生させ、リトライと欠損の扱いを確認できる。
 */
export class MockEngine implements EngineClient {
  readonly name: EngineName;
  readonly model: string;
  calls = 0;
  private readonly failRate: number;
  private readonly random: () => number;

  constructor(name: EngineName, opts: { failRate?: number; random?: () => number } = {}) {
    this.name = name;
    this.model = `mock-${name}`;
    this.failRate = opts.failRate ?? 0;
    this.random = opts.random ?? Math.random;
  }

  async ask(prompt: string, _options: AskOptions = {}): Promise<EngineResult> {
    this.calls++;
    if (this.random() < this.failRate) throw new EngineHttpError(this.name, 503, "mock transient error");
    return {
      text: `【${this.name}のモック回答】${prompt}\n1. サンプルA\n2. サンプルB`,
      citations: [{ url: "https://example.com/source", title: "example.com" }],
      model: this.model,
      usage: { inputTokens: 100, outputTokens: 500, searchCount: 1 },
      request: { prompt },
      raw: { mock: true },
    };
  }
}
