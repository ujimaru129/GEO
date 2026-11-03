import { type FactKeyDef, type FactKeys, type PlansConfig, stableStringify } from "./config.ts";
import type { EntitiesFile } from "./questions/index.ts";

/** 正解データ1件（1バージョン）。更新は上書きせず、新しいバージョンとして追加する */
export type FactRecord = {
  entityId: string;
  key: string;
  value: unknown;
  /** 現実世界でその事実が有効だった期間（両端を含む）。null は無期限 */
  validFrom: string | null;
  validTo: string | null;
  sourceUrl: string;
  checkedAt: string;
  note: string | null;
  importBatch: string;
  createdAt: string;
};

export const CSV_COLUMNS = ["entity_id", "key", "value", "valid_from", "valid_to", "source_url", "checked_at", "note"] as const;
const REQUIRED = ["entity_id", "key", "value", "source_url", "checked_at"] as const;
const STALE_DAYS = 180;

/** RFC 4180 の CSV（ダブルクォート・改行入りセル・BOM 対応） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += ch;
  }
  if (cell !== "" || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

export function parseFactValue(def: FactKeyDef, raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const v = raw.trim();
  if (!v) return { ok: false, error: "値が空です" };
  switch (def.type) {
    case "string":
    case "text":
      return { ok: true, value: v };
    case "list": {
      const items = [...new Set(v.split("|").map((x) => x.trim()).filter(Boolean))];
      return items.length ? { ok: true, value: items } : { ok: false, error: "一覧が空です" };
    }
    case "date":
      return isIsoDate(v) ? { ok: true, value: v } : { ok: false, error: `日付は YYYY-MM-DD で入力してください: ${v}` };
    case "release": {
      const [title, date] = v.split("|").map((x) => x.trim());
      if (!title || !date || !isIsoDate(date)) return { ok: false, error: `「作品名|YYYY-MM-DD」の形式で入力してください: ${v}` };
      return { ok: true, value: { title, date } };
    }
    case "enum":
      return def.values!.includes(v) ? { ok: true, value: v } : { ok: false, error: `${def.values!.join(" / ")} のいずれかを入力してください: ${v}` };
  }
}

const identity = (f: Pick<FactRecord, "entityId" | "key" | "validFrom">) => `${f.entityId}|${f.key}|${f.validFrom ?? ""}`;

/** 各 (対象, 項目, 有効期間の開始) について最新の登録だけを残した、現在有効な正解データ */
export function currentFacts(all: FactRecord[]): FactRecord[] {
  const latest = new Map<string, FactRecord>();
  for (const f of all) {
    const prev = latest.get(identity(f));
    if (!prev || f.createdAt >= prev.createdAt) latest.set(identity(f), f);
  }
  return [...latest.values()];
}

/** ある日付時点で有効な値（判定で「正しい」「古い」を分けるのに使う） */
export function factAt(facts: FactRecord[], entityId: string, key: string, date: string): FactRecord | undefined {
  return currentFacts(facts).find(
    (f) => f.entityId === entityId && f.key === key && (f.validFrom ?? "") <= date && (f.validTo === null || date <= f.validTo),
  );
}

export type ImportResult = {
  toInsert: FactRecord[];
  unchanged: number;
  errors: string[];
  warnings: string[];
};

export function prepareFactImport(
  csvText: string,
  ctx: { entities: EntitiesFile; factKeys: FactKeys; plans: PlansConfig; existing: FactRecord[]; now: Date; batch: string },
): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows = parseCsv(csvText);
  if (rows.length === 0) return { toInsert: [], unchanged: 0, errors: ["CSV が空です"], warnings };
  const header = rows[0].map((h) => h.trim());
  for (const col of REQUIRED) if (!header.includes(col)) errors.push(`列 ${col} がありません（必要な列: ${CSV_COLUMNS.join(", ")}）`);
  for (const col of header) if (!(CSV_COLUMNS as readonly string[]).includes(col)) warnings.push(`未知の列 ${col} は無視します`);
  if (errors.length) return { toInsert: [], unchanged: 0, errors, warnings };

  const entityById = new Map(ctx.entities.entities.map((e) => [e.id, e]));
  const planOfClient = new Map(ctx.entities.clients.map((c) => [c.id, c.plan]));
  const today = new Date(ctx.now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const staleBefore = new Date(ctx.now.getTime() - STALE_DAYS * 86400_000).toISOString().slice(0, 10);
  const createdAt = ctx.now.toISOString();
  const current = new Map(currentFacts(ctx.existing).map((f) => [identity(f), f]));
  const seenInFile = new Map<string, number>();
  const toInsert: FactRecord[] = [];
  let unchanged = 0;

  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (col: string) => (cells[header.indexOf(col)] ?? "").trim();
    const err = (msg: string) => errors.push(`${line}行目: ${msg}`);
    const entityId = get("entity_id");
    const key = get("key");
    const entity = entityById.get(entityId);
    if (!entity) return err(`対象ID ${entityId} が data/entities.yaml にありません`);
    const def = ctx.factKeys[entity.industry]?.[key];
    if (!def) return err(`項目 ${key} は ${entity.industry} の項目辞書（config/fact_keys.yaml）にありません`);
    const parsed = parseFactValue(def, get("value"));
    if (!parsed.ok) return err(`${key}: ${parsed.error}`);
    const validFrom = get("valid_from") || null;
    const validTo = get("valid_to") || null;
    const checkedAt = get("checked_at");
    const sourceUrl = get("source_url");
    let bad = false;
    for (const [name, d] of [["valid_from", validFrom], ["valid_to", validTo], ["checked_at", checkedAt]] as const) {
      if (d && !isIsoDate(d)) (err(`${name} は YYYY-MM-DD で入力してください: ${d}`), (bad = true));
    }
    if (bad) return;
    if (validFrom && validTo && validFrom > validTo) return err("valid_from が valid_to より後になっています");
    if (!/^https?:\/\/\S+$/.test(sourceUrl)) return err(`出典URLが不正です: ${sourceUrl || "（空）"}`);
    if (checkedAt > today) return err(`確認日 ${checkedAt} が未来の日付です`);
    if (checkedAt < staleBefore) warnings.push(`${line}行目: 確認日 ${checkedAt} が ${STALE_DAYS} 日以上前です。最新か再確認してください`);
    if (entity.role === "competitor") warnings.push(`${line}行目: ${entityId} は競合です。競合には指名系の質問をしないため、判定には使われません`);
    const planName = planOfClient.get(entity.client_id)!;
    const planKeys = ctx.plans.plans[planName]?.fact_keys;
    if (planKeys && planKeys !== "all" && !(planKeys[entity.industry] ?? []).includes(key)) {
      warnings.push(`${line}行目: ${key} はプラン ${planName} の正解データ項目に含まれていません`);
    }

    const fact: FactRecord = {
      entityId, key, value: parsed.value, validFrom, validTo, sourceUrl, checkedAt,
      note: get("note") || null, importBatch: ctx.batch, createdAt,
    };
    const id = identity(fact);
    if (seenInFile.has(id)) return err(`${seenInFile.get(id)}行目と同じ対象・項目・valid_from です`);
    seenInFile.set(id, line);
    const prev = current.get(id);
    // DB（jsonb）はオブジェクトのキー順を変えるので、順序に依存しない比較をする
    if (prev && stableStringify(prev.value) === stableStringify(fact.value) && prev.validTo === fact.validTo && prev.sourceUrl === fact.sourceUrl) {
      unchanged++;
      return;
    }
    toInsert.push(fact);
  });

  // 同じ対象・項目で有効期間が重なっていないか（取り込み後の状態で確認）
  const after = new Map(current);
  for (const f of toInsert) after.set(identity(f), f);
  const groups = new Map<string, FactRecord[]>();
  for (const f of after.values()) {
    const g = `${f.entityId}|${f.key}`;
    groups.set(g, [...(groups.get(g) ?? []), f]);
  }
  for (const [g, list] of groups) {
    const sorted = list.sort((a, b) => (a.validFrom ?? "").localeCompare(b.validFrom ?? ""));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      if (prev.validTo === null || (next.validFrom ?? "") <= prev.validTo) {
        errors.push(
          `${g.replace("|", " の ")}: 有効期間が重なっています（${prev.validFrom ?? "開始未設定"}〜${prev.validTo ?? "現在"} と ${next.validFrom ?? "開始未設定"}〜）。` +
            `古い値の valid_to に、新しい値の valid_from の前日を入れてください`,
        );
      }
    }
  }
  return { toInsert: errors.length ? [] : toInsert, unchanged, errors, warnings };
}
