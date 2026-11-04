import { notFound } from "next/navigation";
import { pctNum } from "../../../../components/format.ts";
import { SOURCE_LABEL } from "../../../../src/report/types.ts";
import { reportForToken } from "../../../../src/web/report-data.ts";

export const metadata = { title: "引用元" };

export default async function Sources({ params }: { params: Promise<{ token: string }> }) {
  const data = await reportForToken((await params).token);
  if (!data) notFound();
  const v = data.view;
  if (v.client.report !== "full") notFound();
  const top = v.sources[0]?.share ?? 1;
  return (
    <section className="r-section" aria-labelledby="s-src">
      <span className="o-tag">CITATION SOURCES</span>
      <header>
        <h2 id="s-src">AIが参照したサイト</h2>
        <span className="small muted mono">今週 ・ 引用 {v.citationTotal}件</span>
      </header>
      <p className="lead">
        AIが回答の根拠として示したサイトです。公式サイトの割合は <b className="mono">{v.officialShare === null ? "—" : `${pctNum(v.officialShare)}%`}</b>
        。公式以外のサイトの情報が古いと、AIの回答も古くなりやすくなります。
      </p>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>サイト</th>
              <th>種類</th>
              <th className="num">引用数</th>
              <th className="num">割合</th>
              <th style={{ width: "28%" }}></th>
            </tr>
          </thead>
          <tbody>
            {v.sources.map((s) => (
              <tr key={s.domain}>
                <td className="mono">{s.domain}</td>
                <td>{SOURCE_LABEL[s.sourceType]}</td>
                <td className="num">{s.count}</td>
                <td className="num">{pctNum(s.share)}%</td>
                <td>
                  <div className={`share-bar${s.sourceType === "official" ? " official" : ""}`} aria-hidden>
                    <i style={{ width: `${(s.share / top) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
