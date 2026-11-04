import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 顧客ごとの専用URLのトークン。推測できない 256 bit の乱数を base64url で表す。
 * DB にはハッシュだけを保存するので、DB が漏れても URL は復元できない。
 */
export function generateReportToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashReportToken(token) };
}

export function hashReportToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** URL から来たトークンの形式チェック（DB を引く前に弾く） */
export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function tokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashReportToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
