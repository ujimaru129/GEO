import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "../../../../components/client-ui.tsx";
import { DONE_MESSAGES, jpDateTime } from "../../../../components/format.ts";
import { loadConfig } from "../../../../src/config.ts";
import { reportForToken } from "../../../../src/web/report-data.ts";
import { submitFactAction } from "../actions.ts";

export const metadata = { title: "記入のお願い" };

const STATUS: Record<string, { cls: string; text: string }> = {
  open: { cls: "ai", text: "ご記入ください" },
  submitted: { cls: "plain", text: "確認中" },
  answered: { cls: "ok", text: "反映済み" },
  unknown: { cls: "plain", text: "不明として受付" },
  cancelled: { cls: "plain", text: "取り消し" },
};

const HINT: Record<string, string> = {
  list: "1項目ずつ入力してください（足りなければ「その他」に「、」区切りで）",
  date: "日付を選んでください",
  release: "作品名と発売日を「作品名|2026-10-15」の形で入力してください",
  string: "",
  text: "",
  enum: "",
};

export default async function Requests({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const data = await reportForToken(token);
  if (!data) notFound();
  const config = loadConfig(`${process.cwd()}/config`);
  const defs = config.factKeys[data.view.client.industry] ?? {};
  const requests = [...data.rows.requests].sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || b.requestedAt.localeCompare(a.requestedAt));
  const lastReject = (requestId: string) =>
    data.rows.submissions.filter((s) => s.requestId === requestId && s.status === "rejected").sort((a, b) => (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? ""))[0];
  return (
    <section className="r-section" aria-labelledby="s-req">
      <span className="o-tag">INPUT REQUEST</span>
      <header>
        <h2 id="s-req">記入のお願い</h2>
      </header>
      <p className="lead">
        公開情報だけでは確かめられなかった項目です。ご記入いただいた内容は、担当者が確認してから「正しい情報」として判定に使います。未発表の情報は、公表してよい日を入れてください。その日より前のAIの回答の判定には使いません。
      </p>
      {done && DONE_MESSAGES[done] && (
        <p className="notice ok" role="status">
          {DONE_MESSAGES[done]}
        </p>
      )}
      <div style={{ borderTop: "1px solid var(--rule)" }}>
        {requests.map((r) => {
          const def = defs[r.key];
          const st = STATUS[r.status];
          const rej = r.status === "open" ? lastReject(r.id) : undefined;
          return (
            <article key={r.id} className="req">
              <div className="req-head">
                <h3>{def?.label ?? r.key}</h3>
                <span className={`flag ${st.cls}`}>{st.text}</span>
              </div>
              <p className="muted">{r.reason}</p>
              {rej?.reviewNote && <p className="notice bad">前回のご記入を差し戻しました: {rej.reviewNote}</p>}
              {r.status === "open" && def && (
                <ActionForm action={submitFactAction.bind(null, token, r.id)} className="form-grid">
                  {def.type === "list" ? (
                    <>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <label key={i} className="field">
                          <span>{i === 0 ? `${def.label}（1つずつ）` : " "}</span>
                          <input type="text" name="item" id={`${r.id}-item-${i}`} />
                        </label>
                      ))}
                      <label className="field">
                        <span>その他</span>
                        <input type="text" name="value" id={`${r.id}-value`} placeholder="6つ目以降は「|」区切り" />
                      </label>
                    </>
                  ) : def.type === "date" ? (
                    <label className="field">
                      <span>{def.label}</span>
                      <input type="date" name="value" id={`${r.id}-value`} required />
                    </label>
                  ) : def.type === "enum" ? (
                    <label className="field">
                      <span>{def.label}</span>
                      <select name="value" id={`${r.id}-value`} required defaultValue="">
                        <option value="" disabled>選んでください</option>
                        {def.values?.map((x) => <option key={x} value={x}>{x === "active" ? "サービス中" : x === "end_announced" ? "終了告知済み" : "サービス終了"}</option>)}
                      </select>
                    </label>
                  ) : (
                    <label className="field wide">
                      <span>{def.label}</span>
                      {def.type === "text" ? <textarea name="value" id={`${r.id}-value`} required /> : <input type="text" name="value" id={`${r.id}-value`} required />}
                      {HINT[def.type] && <small>{HINT[def.type]}</small>}
                    </label>
                  )}
                  <label className="field">
                    <span>いつからこの内容か</span>
                    <input type="date" name="validFrom" id={`${r.id}-from`} />
                  </label>
                  <label className="field">
                    <span>公表してよい日（未発表の場合）</span>
                    <input type="date" name="publicFrom" id={`${r.id}-public`} />
                  </label>
                  <label className="field wide">
                    <span>確認できるURL（任意）</span>
                    <input type="url" name="sourceUrl" id={`${r.id}-url`} placeholder="https://" />
                    <small>ない場合は「ご記入いただいた情報」として扱います</small>
                  </label>
                  <label className="field wide">
                    <span>補足（任意）</span>
                    <input type="text" name="note" id={`${r.id}-note`} />
                  </label>
                  <div className="actions wide">
                    <SubmitButton name="intent" value="submit">送信する</SubmitButton>
                    <SubmitButton name="intent" value="unknown" primary={false}>分からない</SubmitButton>
                    <span className="small faint">依頼日 {jpDateTime(r.requestedAt)}</span>
                  </div>
                </ActionForm>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
