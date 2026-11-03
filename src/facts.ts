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
  /** 出典URL。顧客からの申告で公開情報がない場合は null */
  sourceUrl: string | null;
  /** public = 公開情報で確認 / client_provided = 顧客の申告（社内承認済み） */
  sourceType: "public" | "client_provided";
  /** 公表日。これより前の AI の回答はこの事実を知り得ないので、判定に使わない（null = 公表済み） */
  publicFrom: string | null;
  checkedAt: string;
  note: string | null;
  /** 取り込みID（CSV）または申告ID（フォーム） */
  importBatch: string;
  createdAt: string;
};

/** 1件分の入力（CSV の1行、社内フォーム、顧客フォーム共通） */
export type FactInput = {
  entityId: string;
  key: string;
  value: string;
  validFrom?: string | null;
  validTo?: string | null;
  sourceUrl?: string | null;
  sourceType?: FactRecord["sourceType"];
  publicFrom?: string | null;
  checkedAt: string;
  note?: string | null;
};

export type FactContext = { entities: EntitiesFile; factKeys: FactKeys; plans: PlansConfig; now: Date };

export const CSV_COLUMNS = ["entity_id", "key", "value", "valid_from", "valid_to", "source_url", "public_from", "checked_at", "note"] as const;
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

export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

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

export const identity = (f: Pick<FactRecord, "entityId" | "key" | "validFrom">) => `${f.entityId}|${f.key}|${f.validFrom ?? ""}`;

/** 各 (対象, 項目, 有効期間の開始) について最新の登録だけを残した、現在有効な正解データ */
export function currentFacts(all: FactRecord[]): FactRecord[] {
  const latest = new Map<string, FactRecord>();
  for (const f of all) {
    const prev = latest.get(identity(f));
    if (!prev || f.createdAt >= prev.createdAt) latest.set(identity(f), f);
  }
  return [...latest.values()];
}

/**
 * ある日付時点で有効な値（判定で「正しい」「古い」を分けるのに使う）。
 * その日付にまだ公表されていない事実は、AI が知り得ないので返さない（→ 照合不能）。
 */
export function factAt(facts: FactRecord[], entityId: string, key: string, date: string): FactRecord | undefined {
  return currentFacts(facts).find(
    (f) =>
      f.entityId === entityId && f.key === key && (f.validFrom ?? "") <= date && (f.validTo === null || date <= f.validTo) &&
      (f.publicFrom === null || f.publicFrom <= date),
  );
}

/** 1件の入力を検証して FactRecord にする（有効期間の重なりは checkOverlaps で別に確認） */
export function validateFactInput(
  input: FactInput,
  ctx: FactContext,
  meta: { batch: string },
): { fact: FactRecord | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (msg: string) => ({ fact: null, errors: [...errors, msg], warnings });
  const entity = ctx.entities.entities.find((e) => e.id === input.entityId);
  if (!entity) return fail(`対象ID ${input.entityId} が登録されていません`);
  const def = ctx.factKeys[entity.industry]?.[input.key];
  if (!def) return fail(`項目 ${input.key} は ${entity.industry} の項目辞書（config/fact_keys.yaml）にありません`);
  const parsed = parseFactValue(def, input.value);
  if (!parsed.ok) return fail(`${def.label}: ${parsed.error}`);
  const validFrom = input.validFrom?.trim() || null;
  const validTo = input.validTo?.trim() || null;
  const publicFrom = input.publicFrom?.trim() || null;
  const checkedAt = input.checkedAt.trim();
  const sourceType = input.sourceType ?? "public";
  const sourceUrl = input.sourceUrl?.trim() || null;
  for (const [name, d] of [["valid_from", validFrom], ["valid_to", validTo], ["public_from", publicFrom], ["checked_at", checkedAt]] as const) {
    if (d && !isIsoDate(d)) errors.push(`${name} は YYYY-MM-DD で入力してください: ${d}`);
  }
  if (!checkedAt) errors.push("確認日を入力してください");
  if (errors.length) return { fact: null, errors, warnings };
  if (validFrom && validTo && validFrom > validTo) return fail("valid_from が valid_to より後になっています");
  if (sourceType === "public" && !(sourceUrl && /^https?:\/\/\S+$/.test(sourceUrl))) return fail(`出典URLが不正です: ${sourceUrl || "（空）"}`);
  if (sourceUrl && !/^https?:\/\/\S+$/.test(sourceUrl)) return fail(`出典URLが不正です: ${sourceUrl}`);
  const today = new Date(ctx.now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const staleBefore = new Date(ctx.now.getTime() - STALE_DAYS * 86400_000).toISOString().slice(0, 10);
  if (checkedAt > today) return fail(`確認日 ${checkedAt} が未来の日付です`);
  if (checkedAt < staleBefore) warnings.push(`確認日 ${checkedAt} が ${STALE_DAYS} 日以上前です。最新か再確認してください`);
  if (publicFrom && publicFrom > today) warnings.push(`公表日 ${publicFrom} より前の AI の回答には、この事実を判定に使いません`);
  if (entity.role === "competitor") warnings.push(`${entity.id} は競合です。競合には指名系の質問をしないため、判定には使われません`);
  const planName = ctx.entities.clients.find((c) => c.id === entity.client_id)?.plan;
  const planKeys = planName ? ctx.plans.plans[planName]?.fact_keys : undefined;
  if (planKeys && planKeys !== "all" && !(planKeys[entity.industry] ?? []).includes(input.key)) {
    warnings.push(`${input.key} はプラン ${planName} の正解データ項目に含まれていません`);
  }
  return {
    fact: {
      entityId: entity.id, key: input.key, value: parsed.value, validFrom, validTo, sourceUrl, sourceType, publicFrom, checkedAt,
      note: input.note?.trim() || null, importBatch: meta.batch, createdAt: ctx.now.toISOString(),
    },
    errors,
    warnings,
  };
}

/** 既存と内容が同じか（DB の jsonb はキー順を変えるので順序に依存しない比較） */
export function sameFact(a: FactRecord, b: FactRecord): boolean {
  return (
    stableStringify(a.value) === stableStringify(b.value) && a.validTo === b.validTo && a.sourceUrl === b.sourceUrl &&
    a.publicFrom === b.publicFrom && a.sourceType === b.sourceType
  );
}

/** 追加後の状態で、同じ対象・項目の有効期間が重ならないか */
export function checkOverlaps(existing: FactRecord[], toInsert: FactRecord[]): string[] {
  const after = new Map(currentFacts(existing).map((f) => [identity(f), f]));
  for (const f of toInsert) after.set(identity(f), f);
  const groups = new Map<string, FactRecord[]>();
  for (const f of after.values()) {
    const g = `${f.entityId}|${f.key}`;
    groups.set(g, [...(groups.get(g) ?? []), f]);
  }
  const errors: string[] = [];
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
  return errors;
}

export type ImportResult = {
  toInsert: FactRecord[];
  unchanged: number;
  errors: string[];
  warnings: string[];
};

export function prepareFactImport(
  csvText: string,
  ctx: FactContext & { existing: FactRecord[]; batch: string },
): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows = parseCsv(csvText);
  if (rows.length === 0) return { toInsert: [], unchanged: 0, errors: ["CSV が空です"], warnings };
  const header = rows[0].map((h) => h.trim());
  for (const col of REQUIRED) if (!header.includes(col)) errors.push(`列 ${col} がありません（必要な列: ${CSV_COLUMNS.join(", ")}）`);
  for (const col of header) if (!(CSV_COLUMNS as readonly string[]).includes(col)) warnings.push(`未知の列 ${col} は無視します`);
  if (errors.length) return { toInsert: [], unchanged: 0, errors, warnings };

  const current = new Map(currentFacts(ctx.existing).map((f) => [identity(f), f]));
  const seenInFile = new Map<string, number>();
  const toInsert: FactRecord[] = [];
  let unchanged = 0;

  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (col: string) => (cells[header.indexOf(col)] ?? "").trim();
    const r = validateFactInput(
      {
        entityId: get("entity_id"), key: get("key"), value: get("value"), validFrom: get("valid_from"), validTo: get("valid_to"),
        sourceUrl: get("source_url"), publicFrom: get("public_from"), checkedAt: get("checked_at"), note: get("note"),
      },
      ctx,
      { batch: ctx.batch },
    );
    for (const e of r.errors) errors.push(`${line}行目: ${e}`);
    for (const w of r.warnings) warnings.push(`${line}行目: ${w}`);
    if (!r.fact) return;
    const id = identity(r.fact);
    if (seenInFile.has(id)) return void errors.push(`${line}行目: ${seenInFile.get(id)}行目と同じ対象・項目・valid_from です`);
    seenInFile.set(id, line);
    const prev = current.get(id);
    if (prev && sameFact(prev, r.fact)) return void unchanged++;
    toInsert.push(r.fact);
  });

  errors.push(...checkOverlaps(ctx.existing, toInsert));
  return { toInsert: errors.length ? [] : toInsert, unchanged, errors, warnings };
}
