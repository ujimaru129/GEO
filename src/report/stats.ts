/** ウィルソン法の95%信頼区間（仕様: 出現率と正確率に付ける） */
export function wilson(successes: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export type Metric = {
  value: number;
  low: number;
  high: number;
  successes: number;
  n: number;
  prev: number | null;
  /** 前回の値が今回の信頼区間の中にあれば flat（揺れを改善・悪化と誤認しない） */
  change: "up" | "down" | "flat" | null;
};

export function metric(successes: number, n: number, prev: { successes: number; n: number } | null): Metric {
  const value = n ? successes / n : 0;
  const { low, high } = wilson(successes, n);
  const prevValue = prev && prev.n ? prev.successes / prev.n : null;
  let change: Metric["change"] = null;
  if (prevValue !== null && n) change = prevValue >= low && prevValue <= high ? "flat" : value > prevValue ? "up" : "down";
  return { value, low, high, successes, n, prev: prevValue, change };
}

/** 日本時間の週（月曜始まり）。キーは月曜の日付 */
export function jstWeekStart(iso: string): string {
  const jst = new Date(Date.parse(iso) + 9 * 3600_000);
  const dow = (jst.getUTCDay() + 6) % 7; // 月曜=0
  const monday = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - dow));
  return monday.toISOString().slice(0, 10);
}

export function jstDate(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
}

export function isoWeekNumber(ymd: string): number {
  const d = new Date(`${ymd}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86400_000 + 1) / 7);
}
