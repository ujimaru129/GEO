import { notFound } from "next/navigation";
import { CopyButton } from "../../../../components/client-ui.tsx";
import { EFFORT_LABEL, PRIORITY_LABEL, ymdSlash } from "../../../../components/format.ts";
import { reportForToken } from "../../../../src/web/report-data.ts";

export const metadata = { title: "改善の助言" };

export default async function Advice({ params }: { params: Promise<{ token: string }> }) {
  const data = await reportForToken((await params).token);
  if (!data) notFound();
  const v = data.view;
  const a = v.advice;
  return (
    <section className="r-section" aria-labelledby="s-adv">
      <header>
        <h2 id="s-adv">結果を受けて、やるべきこと</h2>
        {a?.approvedAt && <span className="small muted mono">{ymdSlash(a.approvedAt.slice(0, 10))} 時点</span>}
      </header>
      {!a ? (
        <p className="muted">助言は担当者の確認後に表示されます。</p>
      ) : (
        <>
          <p className="lead">優先度の高い順に並べています。文面の下書きがある項目は、そのままコピーしてお使いいただけます。</p>
          {a.comment && (
            <div className="from-staff">
              <span className="who">担当者より</span>
              <p>{a.comment}</p>
            </div>
          )}
          <ol className="advice" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {a.items.map((it, i) => (
              <li key={i} className="adv">
                <span className={`pri ${it.priority}`} aria-label={`優先度 ${PRIORITY_LABEL[it.priority]}`}>
                  {PRIORITY_LABEL[it.priority]}
                </span>
                <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                  <p className="what">{it.action}</p>
                  <p className="why">{it.reason}</p>
                  <p className="meta">{EFFORT_LABEL[it.effort]}</p>
                  {it.draft && (
                    <div className="draft">
                      <div className="bar">
                        <span className="label">文面の下書き</span>
                        <CopyButton text={it.draft} />
                      </div>
                      <p>{it.draft}</p>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {v.client.plan === "lite" && (
            <p className="readme">
              Basic・Pro プランでは、毎週の計測で施策の効果（AIの回答が正しくなるまでの日数など）を追いかけられます。
            </p>
          )}
        </>
      )}
    </section>
  );
}
