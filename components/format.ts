import type { Metric } from "../src/report/stats.ts";

export const pctNum = (v: number) => Math.round(v * 100);

export function ciText(m: Metric) {
  if (!m.n) return "データなし";
  return `95%区間 ${pctNum(m.low)}–${pctNum(m.high)}% ・ n=${m.n}`;
}

export function deltaText(m: Metric): { cls: string; text: string } | null {
  if (m.change === null || m.prev === null) return null;
  const pt = pctNum(m.value) - pctNum(m.prev);
  if (m.change === "flat") return { cls: "flat", text: `変化なし（前回 ${pctNum(m.prev)}%、区間内）` };
  return { cls: m.change, text: `${m.change === "up" ? "▲" : "▼"} ${Math.abs(pt)}pt（前回 ${pctNum(m.prev)}%）` };
}

export const ymdSlash = (ymd: string) => ymd.replaceAll("-", "/");
export const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

export function jpDateTime(iso: string) {
  const d = new Date(Date.parse(iso) + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export const yen = (v: number) => `¥${Math.round(v).toLocaleString("ja-JP")}`;

export const PRIORITY_LABEL = { high: "高", mid: "中", low: "低" } as const;
export const EFFORT_LABEL = { small: "手間 小", mid: "手間 中", large: "手間 大" } as const;

/** 操作のあと（?done=...）にページ上部へ出すメッセージ */
export const DONE_MESSAGES: Record<string, string> = {
  submitted: "送信しました。担当者が確認してから反映します。",
  unknown: "「分からない」として受け付けました。ご協力ありがとうございます。",
  "claim-incorrect": "「誤り」で確定しました。顧客のレポートに載ります。",
  "claim-changed": "判定を変更しました。",
  advice: "助言を承認しました。顧客のレポートに表示されます。",
  approved: "承認して正解データに反映しました。",
  rejected: "差し戻しました。理由は顧客の画面に表示されます。",
};
