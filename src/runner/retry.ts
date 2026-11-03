import { EngineHttpError } from "../engines/types.ts";

export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

export class RetryExhaustedError extends Error {
  readonly attempts: number;
  readonly lastError: unknown;
  constructor(attempts: number, lastError: unknown) {
    super(lastError instanceof Error ? lastError.message : String(lastError));
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof EngineHttpError) return err.retryable;
  if (err instanceof Error) {
    // タイムアウト・通信断・レスポンスJSON破損は再試行する
    return err.name === "TimeoutError" || err.name === "AbortError" || err.name === "SyntaxError" || err instanceof TypeError;
  }
  return false;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 指数バックオフ（+ジッター）で再試行。Retry-After があればそれを優先 */
export async function withRetry<T>(
  fn: (attempt: number, isLast: boolean) => Promise<T>,
  opts: RetryOptions,
): Promise<{ value: T; attempts: number }> {
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return { value: await fn(attempt, attempt === opts.maxAttempts), attempts: attempt };
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === opts.maxAttempts) throw new RetryExhaustedError(attempt, err);
      const backoff = opts.baseDelayMs * 2 ** (attempt - 1) * (0.75 + random() * 0.5);
      const retryAfter = err instanceof EngineHttpError ? err.retryAfterMs : undefined;
      await sleep(Math.max(backoff, retryAfter ?? 0));
    }
  }
  throw new RetryExhaustedError(opts.maxAttempts, lastError);
}
