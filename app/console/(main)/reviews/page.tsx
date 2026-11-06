import { ActionForm, SubmitButton } from "../../../../components/client-ui.tsx";
import { DONE_MESSAGES, EFFORT_LABEL, PRIORITY_LABEL, jpDateTime } from "../../../../components/format.ts";
import { ENGINE_LABEL, SOURCE_LABEL } from "../../../../src/report/types.ts";
import { getRepo } from "../../../../src/web/index.ts";
import { approveAdviceAction, decideClaimAction } from "../../actions.ts";

export const metadata = { title: "判定の確認" };

export default async function Reviews({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const { done } = await searchParams;
  const repo = getRepo();
  const [items, drafts] = await Promise.all([repo.pendingReviews(), repo.adviceDrafts()]);
  return (
    <>
      <div className="c-title">
        <h1>判定の確認</h1>
        <span className="meta">
          誤り {items.length}件 ・ 助言 {drafts.length}件
        </span>
      </div>

      {done && DONE_MESSAGES[done] && (
        <p className="notice ok" role="status">
          {DONE_MESSAGES[done]}
        </p>
      )}
      <section className="c-section" data-accent="pink">
        <header>
          <h2>「誤り」判定</h2>
          <span className="small muted">確認したものだけが顧客のレポートに載ります。「古い」「正しい」は自動で公開されます。</span>
        </header>
        {items.length === 0 ? (
          <p className="muted">確認待ちはありません。</p>
        ) : (
          <div>
            {items.map((it) => (
              <article key={it.claimId} className="review">
                <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                  <span className="who">
                    {it.clientName} ・ {it.targetName} ・ {ENGINE_LABEL[it.engine]} ・ <span className="mono">{jpDateTime(it.executedAt)}</span> ・ 確信度{" "}
                    <span className="mono">{it.confidence.toFixed(2)}</span>
                  </span>
                  <p className="said">
                    <span className="verdict bad">誤り?</span> {it.factLabel}: {it.statement}
                  </p>
                  <blockquote>{it.evidence}</blockquote>
                  <p className="small">
                    <span className="faint">正解データ: </span>
                    {it.truth ?? <span className="faint">未登録（照合不能にするのが妥当）</span>}
                  </p>
                  {it.sources.length > 0 && (
                    <p className="small faint mono">
                      {it.sources.map((s) => `${s.domain}（${SOURCE_LABEL[s.sourceType]}）`).join(" ・ ")}
                    </p>
                  )}
                </div>
                <ActionForm action={decideClaimAction.bind(null, it.claimId)}>
                  <div className="choices">
                    <SubmitButton name="decision" value="incorrect">誤りで確定</SubmitButton>
                    <SubmitButton name="decision" value="outdated" primary={false}>古いに変更</SubmitButton>
                    <SubmitButton name="decision" value="correct" primary={false}>正しいに変更</SubmitButton>
                    <SubmitButton name="decision" value="unverifiable" primary={false}>照合不能</SubmitButton>
                  </div>
                  <label className="field">
                    <span>メモ（任意・社内のみ）</span>
                    <input type="text" name="note" id={`note-${it.claimId}`} />
                  </label>
                </ActionForm>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="c-section" data-accent="pink">
        <header>
          <h2>改善の助言（下書き）</h2>
          <span className="small muted">承認すると顧客のレポートの「改善の助言」に表示されます。</span>
        </header>
        {drafts.length === 0 ? (
          <p className="muted">確認待ちはありません。</p>
        ) : (
          drafts.map((d) => (
            <article key={d.id} className="review">
              <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
                <span className="who">
                  {d.clientName} ・ 作成 <span className="mono">{jpDateTime(d.createdAt)}</span>
                </span>
                <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 8 }}>
                  {d.items.map((it, i) => (
                    <li key={i} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: 8 }}>
                      <b style={{ fontFamily: "var(--f-mincho)" }}>{PRIORITY_LABEL[it.priority]}</b>
                      <span>
                        {it.action}
                        <span className="small faint" style={{ display: "block" }}>
                          {it.reason} ・ {EFFORT_LABEL[it.effort]}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <ActionForm action={approveAdviceAction.bind(null, d.id)}>
                <label className="field">
                  <span>担当者コメント（Pro のみ表示・任意）</span>
                  <textarea name="comment" id={`comment-${d.id}`} defaultValue={d.comment ?? ""} />
                </label>
                <div className="actions">
                  <SubmitButton>承認して公開</SubmitButton>
                </div>
              </ActionForm>
            </article>
          ))
        )}
      </section>
    </>
  );
}
