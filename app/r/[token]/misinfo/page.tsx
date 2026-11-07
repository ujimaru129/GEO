import { notFound } from "next/navigation";
import { md, ymdSlash } from "../../../../components/format.ts";
import { ENGINE_LABEL, SOURCE_LABEL } from "../../../../src/report/types.ts";
import { reportForToken } from "../../../../src/web/report-data.ts";

export const metadata = { title: "誤った情報" };

export default async function Misinfo({ params }: { params: Promise<{ token: string }> }) {
  const data = await reportForToken((await params).token);
  if (!data) notFound();
  const v = data.view;
  const ongoing = v.misinfo.filter((m) => m.ongoing);
  const resolved = v.misinfo.filter((m) => !m.ongoing);
  return (
    <section className="r-section" data-accent="pink" aria-labelledby="s-misinfo">
      <span className="o-tag">MISINFORMATION LOG</span>
      <header>
        <h2 id="s-misinfo">AIが誤って伝えていること</h2>
        <span className="small muted">
          継続中 {ongoing.length}件 ・ 解消 {resolved.length}件
        </span>
      </header>
      <p className="lead">
        登録いただいた正しい情報と、AIの回答を照らし合わせた結果です。「古い」は過去には正しかった情報、「誤り」は一度も正しくなかった情報です。「誤り」は担当者が確認したものだけを載せています。
      </p>
      {v.misinfo.length === 0 ? (
        <p className="notice ok">誤った情報・古い情報は見つかっていません。</p>
      ) : (
        <div className="ledger">
          {[...ongoing, ...resolved].map((m) => (
            <article key={m.key} className={`entry${m.ongoing ? "" : " resolved"}`}>
              <div className="k">
                <span className={`verdict ${m.verdict === "incorrect" ? "bad" : "old"}`}>{m.verdict === "incorrect" ? "誤り" : "古い情報"}</span>
                <span className="fact">{m.factLabel}</span>
                {m.review && (
                  <span className="stamp" title={`${m.review.reviewerName} が確認`}>
                    確認済
                    <span>{m.review.reviewerName}</span>
                  </span>
                )}
              </div>
              <div className="claim">
                <p className="said">{m.statement}</p>
                {m.truth && <p className="truth">{m.truth}</p>}
                <details>
                  <summary>AIの回答の該当箇所</summary>
                  <blockquote>{m.evidence}</blockquote>
                </details>
              </div>
              <div className="side">
                <div className="engines">
                  {m.engines.map((e) => (
                    <span key={e}>{ENGINE_LABEL[e]}</span>
                  ))}
                </div>
                {m.ongoing ? (
                  <span>
                    今週 <span className="mono">{m.latestCount}/{m.latestN}</span> 回
                  </span>
                ) : (
                  <span className="flag ok">解消</span>
                )}
                <span className="mono faint">
                  {ymdSlash(m.firstSeen)}〜{m.ongoing ? "継続中" : md(m.lastSeen)}
                </span>
                {m.sources.length > 0 && (
                  <details className="srcs">
                    <summary>主な引用元（{m.sources.length}）</summary>
                    {m.sources.map((s) => (
                      <span key={s.domain} className="src" title={s.domain}>
                        <span className="mono">{s.domain}</span>
                        <span className="t">{SOURCE_LABEL[s.sourceType]}</span>
                      </span>
                    ))}
                  </details>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
