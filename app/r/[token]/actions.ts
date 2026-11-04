"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRepo } from "../../../src/web/index.ts";
import type { ActionResult } from "../../../src/web/repo.ts";

const str = (d: FormData, k: string) => {
  const v = d.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/** 顧客: 記入依頼への回答。トークンから顧客を特定し、その顧客の依頼にしか書き込めない */
export async function submitFactAction(token: string, requestId: string, _prev: ActionResult | null, data: FormData): Promise<ActionResult> {
  const repo = getRepo();
  const clientId = await repo.clientIdForToken(token);
  if (!clientId) return { ok: false, errors: ["このURLは無効です"] };
  let r: ActionResult;
  if (str(data, "intent") === "unknown") {
    r = await repo.clientAnswerUnknown(clientId, requestId);
  } else {
    const list = data.getAll("item").map((x) => String(x).trim()).filter(Boolean);
    const extra = str(data, "value");
    // 一覧（メンバーなど）は1つずつの欄＋「その他」をまとめる
    const value = list.length ? [...list, ...extra.split(/[|、]/).map((x) => x.trim()).filter(Boolean)].join("|") : extra;
    r = await repo.clientSubmitFact(clientId, requestId, {
      value,
      validFrom: str(data, "validFrom") || undefined,
      publicFrom: str(data, "publicFrom") || undefined,
      sourceUrl: str(data, "sourceUrl") || undefined,
      note: str(data, "note") || undefined,
    });
  }
  if (!r.ok) return r;
  revalidatePath(`/r/${token}`, "layout");
  redirect(`/r/${token}/requests?done=${str(data, "intent") === "unknown" ? "unknown" : "submitted"}`);
}
