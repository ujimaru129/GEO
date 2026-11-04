"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Verdict } from "../../src/report/types.ts";
import { requireStaff, supabaseConfigured, supabaseServer } from "../../src/web/auth.ts";
import { getRepo } from "../../src/web/index.ts";
import type { ActionResult } from "../../src/web/repo.ts";

const str = (d: FormData, k: string) => {
  const v = d.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const VERDICTS: Verdict[] = ["correct", "incorrect", "outdated", "unverifiable"];

export async function decideClaimAction(claimId: string, _prev: ActionResult | null, data: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const decision = str(data, "decision") as Verdict;
  if (!VERDICTS.includes(decision)) return { ok: false, errors: ["判定を選んでください"] };
  const r = await getRepo().decideClaim(claimId, decision, str(data, "note") || null, staff);
  if (!r.ok) return r;
  revalidatePath("/console", "layout");
  redirect(`/console/reviews?done=${decision === "incorrect" ? "claim-incorrect" : "claim-changed"}`);
}

export async function approveAdviceAction(adviceId: string, _prev: ActionResult | null, data: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const r = await getRepo().approveAdvice(adviceId, str(data, "comment") || null, staff);
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  redirect("/console/reviews?done=advice");
}

export async function createRequestAction(clientId: string, _prev: ActionResult | null, data: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const [entityId, key] = str(data, "target").split("::");
  const r = await getRepo().createRequest({ clientId, entityId, key, reason: str(data, "reason") }, staff);
  if (r.ok) revalidatePath("/console", "layout");
  return r;
}

export async function reviewSubmissionAction(clientId: string, submissionId: string, _prev: ActionResult | null, data: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const intent = str(data, "intent");
  const repo = getRepo();
  const r =
    intent === "reject"
      ? await repo.rejectSubmission(submissionId, str(data, "note"), staff)
      : await repo.approveSubmission(submissionId, intent === "approve-close", staff);
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  redirect(`/console/facts?client=${encodeURIComponent(clientId)}&done=${intent === "reject" ? "rejected" : "approved"}`);
}

export async function addFactAction(_prev: ActionResult | null, data: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const [entityId, key] = str(data, "target").split("::");
  const r = await getRepo().addStaffFact(
    {
      entityId, key, value: str(data, "value"), validFrom: str(data, "validFrom") || null, validTo: str(data, "validTo") || null,
      sourceUrl: str(data, "sourceUrl") || null, publicFrom: str(data, "publicFrom") || null, checkedAt: str(data, "checkedAt"), note: str(data, "note") || null,
    },
    staff,
  );
  if (r.ok) revalidatePath("/console", "layout");
  return r;
}

export async function issueLinkAction(clientId: string, _prev: ActionResult | null, _data: FormData): Promise<ActionResult> {
  const staff = await requireStaff();
  const { token } = await getRepo().issueLink(clientId, staff);
  revalidatePath("/console", "layout");
  // トークンはここでしか表示しない（DB にはハッシュだけ）
  return { ok: true, message: `/r/${token}` };
}

export async function signInAction(_prev: ActionResult | null, data: FormData): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, errors: ["ログインの設定（Supabase）がまだありません"] };
  const email = str(data, "email").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return { ok: false, errors: ["メールアドレスを入力してください"] };
  // 許可リストにない人にはメールを送らない（存在の有無は画面では区別しない）
  const staff = await getRepo().staffByEmail(email);
  if (staff) {
    const supabase = await supabaseServer();
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: `${origin}/console/auth/callback` } });
    if (error) return { ok: false, errors: ["メールを送れませんでした。時間をおいて試してください"] };
  }
  return { ok: true, message: "登録されているアドレスなら、ログイン用のリンクを送りました。メールを確認してください。" };
}

export async function signOutAction() {
  if (supabaseConfigured()) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  redirect("/console/login");
}
