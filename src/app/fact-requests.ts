// 正解データの記入依頼と承認の流れ（社内・顧客の両方から入力できるようにする）
//
//   社内が分かる項目   → 社内フォーム / CSV で直接登録（prepareStaffFact / facts:import）
//   社内で分からない項目 → 記入依頼(open) → 顧客が記入(submitted) → 社内が承認(answered) or 差し戻し(open に戻る)
//                                       → 顧客も分からない(unknown)。この項目は「照合不能」のまま
import { randomUUID } from "node:crypto";
import {
  type FactContext,
  type FactInput,
  type FactRecord,
  checkOverlaps,
  currentFacts,
  validateFactInput,
} from "../facts.ts";

export type FactRequestStatus = "open" | "submitted" | "answered" | "unknown" | "cancelled";

export type FactRequest = {
  id: string;
  clientId: string;
  entityId: string;
  key: string;
  /** 顧客に表示する依頼理由（例: 公式サイトとSNSで人数が食い違っています） */
  reason: string;
  requestedBy: string;
  requestedAt: string;
  status: FactRequestStatus;
  closedAt: string | null;
};

export type FactSubmission = {
  id: string;
  requestId: string | null;
  clientId: string;
  entityId: string;
  key: string;
  input: Omit<FactInput, "entityId" | "key">;
  via: "client_form" | "staff_form";
  submittedBy: string;
  submittedAt: string;
  status: "pending" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

export type Result<T> = { ok: true; value: T; warnings: string[] } | { ok: false; errors: string[] };

const jstToday = (now: Date) => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

/** 社内: 顧客に記入を依頼する（同じ項目に未完了の依頼があれば作らない） */
export function createFactRequest(
  ctx: FactContext,
  existing: FactRequest[],
  args: { clientId: string; entityId: string; key: string; reason: string; staffEmail: string },
): Result<FactRequest> {
  const entity = ctx.entities.entities.find((e) => e.id === args.entityId);
  if (!entity || entity.client_id !== args.clientId) return { ok: false, errors: [`対象 ${args.entityId} はこの顧客の登録ではありません`] };
  if (entity.role !== "target") return { ok: false, errors: ["競合の正解データは判定に使わないため、記入依頼できません"] };
  if (!ctx.factKeys[entity.industry]?.[args.key]) return { ok: false, errors: [`項目 ${args.key} は項目辞書にありません`] };
  if (!args.reason.trim()) return { ok: false, errors: ["顧客に表示する依頼理由を入力してください"] };
  if (existing.some((r) => r.entityId === args.entityId && r.key === args.key && (r.status === "open" || r.status === "submitted"))) {
    return { ok: false, errors: ["この項目にはすでに未完了の依頼があります"] };
  }
  return {
    ok: true,
    warnings: [],
    value: {
      id: randomUUID(), clientId: args.clientId, entityId: args.entityId, key: args.key, reason: args.reason.trim(),
      requestedBy: args.staffEmail, requestedAt: ctx.now.toISOString(), status: "open", closedAt: null,
    },
  };
}

/**
 * 顧客: 依頼に記入する。入力ミスはその場で顧客に返す。
 * 出典URLがなければ「顧客の申告」として扱い、承認後も sourceType = client_provided で記録する。
 */
export function submitByClient(
  ctx: FactContext,
  request: FactRequest,
  clientId: string,
  input: { value: string; validFrom?: string | null; validTo?: string | null; publicFrom?: string | null; sourceUrl?: string | null; note?: string | null },
): Result<{ submission: FactSubmission; request: FactRequest }> {
  if (request.clientId !== clientId) return { ok: false, errors: ["この依頼にはアクセスできません"] };
  if (request.status !== "open") return { ok: false, errors: ["この依頼はすでに受け付け済みです"] };
  const full: Omit<FactInput, "entityId" | "key"> = {
    ...input,
    sourceType: input.sourceUrl?.trim() ? "public" : "client_provided",
    checkedAt: jstToday(ctx.now),
  };
  const v = validateFactInput({ ...full, entityId: request.entityId, key: request.key }, ctx, { batch: "check" });
  if (!v.fact) return { ok: false, errors: v.errors };
  const submission: FactSubmission = {
    id: randomUUID(), requestId: request.id, clientId, entityId: request.entityId, key: request.key, input: full,
    via: "client_form", submittedBy: `client:${clientId}`, submittedAt: ctx.now.toISOString(), status: "pending",
    reviewedBy: null, reviewedAt: null, reviewNote: null,
  };
  return { ok: true, warnings: [], value: { submission, request: { ...request, status: "submitted" } } };
}

/** 顧客: 「分からない」と回答する。この項目は照合不能のまま扱う */
export function answerUnknown(ctx: FactContext, request: FactRequest, clientId: string): Result<FactRequest> {
  if (request.clientId !== clientId) return { ok: false, errors: ["この依頼にはアクセスできません"] };
  if (request.status !== "open") return { ok: false, errors: ["この依頼はすでに受け付け済みです"] };
  return { ok: true, warnings: [], value: { ...request, status: "unknown", closedAt: ctx.now.toISOString() } };
}

const dayBefore = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);

/**
 * 社内: 記入を承認して正解データにする。
 * closePrevious = true なら、現在有効な古い値（valid_to が空）を新しい値の valid_from の前日で閉じる
 * （例: 卒業でメンバーが変わった、事務所を移籍した）。
 */
export function approveSubmission(
  ctx: FactContext,
  submission: FactSubmission,
  request: FactRequest | null,
  existingFacts: FactRecord[],
  reviewer: string,
  opts: { closePrevious?: boolean } = {},
): Result<{ facts: FactRecord[]; submission: FactSubmission; request: FactRequest | null }> {
  if (submission.status !== "pending") return { ok: false, errors: ["この記入はすでに処理済みです"] };
  const v = validateFactInput(
    { ...submission.input, entityId: submission.entityId, key: submission.key },
    ctx,
    { batch: `submission:${submission.id}` },
  );
  if (!v.fact) return { ok: false, errors: v.errors };
  const fact = v.fact;
  const toInsert: FactRecord[] = [];
  if (opts.closePrevious) {
    if (!fact.validFrom) return { ok: false, errors: ["古い値を閉じるには、新しい値の valid_from（いつから）が必要です"] };
    const open = currentFacts(existingFacts).filter(
      (f) => f.entityId === fact.entityId && f.key === fact.key && f.validTo === null && (f.validFrom ?? "") < fact.validFrom!,
    );
    for (const f of open) {
      toInsert.push({ ...f, validTo: dayBefore(fact.validFrom), importBatch: fact.importBatch, createdAt: ctx.now.toISOString() });
    }
  }
  toInsert.push(fact);
  const overlaps = checkOverlaps(existingFacts, toInsert);
  if (overlaps.length) return { ok: false, errors: [...overlaps, "古い値を閉じる場合は「古い値を終了して承認」を選んでください"] };
  const at = ctx.now.toISOString();
  return {
    ok: true,
    warnings: v.warnings,
    value: {
      facts: toInsert,
      submission: { ...submission, status: "approved", reviewedBy: reviewer, reviewedAt: at },
      request: request ? { ...request, status: "answered", closedAt: at } : null,
    },
  };
}

/** 社内: 記入を差し戻す。依頼は記入待ちに戻り、理由が顧客に表示される */
export function rejectSubmission(
  ctx: FactContext,
  submission: FactSubmission,
  request: FactRequest | null,
  reviewer: string,
  note: string,
): Result<{ submission: FactSubmission; request: FactRequest | null }> {
  if (submission.status !== "pending") return { ok: false, errors: ["この記入はすでに処理済みです"] };
  if (!note.trim()) return { ok: false, errors: ["顧客に表示する差し戻し理由を入力してください"] };
  return {
    ok: true,
    warnings: [],
    value: {
      submission: { ...submission, status: "rejected", reviewedBy: reviewer, reviewedAt: ctx.now.toISOString(), reviewNote: note.trim() },
      request: request ? { ...request, status: "open" } : null,
    },
  };
}

/** 社内: フォームから1件登録（CSV と同じ検証。社内入力は承認なしで反映） */
export function prepareStaffFact(
  ctx: FactContext,
  input: FactInput,
  existingFacts: FactRecord[],
  staffEmail: string,
): Result<FactRecord> {
  const v = validateFactInput({ ...input, sourceType: "public" }, ctx, { batch: `staff:${staffEmail}:${ctx.now.toISOString()}` });
  if (!v.fact) return { ok: false, errors: v.errors };
  const overlaps = checkOverlaps(existingFacts, [v.fact]);
  if (overlaps.length) return { ok: false, errors: overlaps };
  return { ok: true, value: v.fact, warnings: v.warnings };
}
