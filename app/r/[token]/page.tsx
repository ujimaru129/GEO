import { notFound } from "next/navigation";
import { ciText, deltaText, pctNum } from "../../../components/format.ts";
import type { Metric } from "../../../src/report/stats.ts";
import { reportForToken } from "../../../src/web/report-data.ts";

function Score({ name, note, m, suffix = "%" }: { name: string; note: string; m: Metric; suffix?: string }) {
  const d = deltaText(m);
  return (
    <div className="score">
      <span className="name">
        {name}
        <em>{note}</em>
      </span>
      <span className="fig">
        {m.n ? pctNum(m.value) : "—"}
        {m.n > 0 && <small>{suffix}</small>}
      </span>
      <span className="ci">{ciText(m)}</span>
      {d && <span className={`delta ${d.cls}`}>{d.text}</span>}
    </div>
  );
}

export default async function Summary({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await reportForToken(token);
  if (!data) notFound();
  const v = data.view;
  if (!v.hasData) {
    return <p className="muted">まだ計測結果がありません。初回の計測が終わると、ここに結果が表示されます。</p>;
  }
  return (
    <>
      <section className="r-section" aria-labelledby="s-scores">
        <header>
          <h2 id="s-scores">今週の結果</h2>
        </header>
        <div className="scores">
          <Score name="推薦" note="シェア・オブ・AI" m={v.share} />
          <Score name="正確性" note="正しく答えた割合" m={v.accuracy} />
          <div className="score">
            <span className="name">
              誤った情報<em>継続中</em>
            </span>
            <span className="fig">
              {v.misinfoOngoing}
              <small>件</small>
            </span>
            <span className="ci">うち古い情報 {v.outdatedOngoing}件</span>
            {v.misinfoOngoing > 0 && (
              <a className="delta" href={`/r/${token}/misinfo`}>
                一覧を見る
              </a>
            )}
          </div>
        </div>
        <p className="readme">
          推薦は「おすすめを聞く質問」で、競合を含めた言及のうち{v.target.name}が占める割合です。95%区間はAIの回答の揺れを考えた幅で、前回の値がこの幅の中にあるときは「変化なし」と表示しています。
        </p>
      </section>

      <div className="two-col">
        <section className="r-section" aria-labelledby="s-engines">
          <header>
            <h2 id="s-engines">AIごとの結果</h2>
          </header>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>AI</th>
                  <th className="num">おすすめに出た割合</th>
                  <th className="num">正しく答えた割合</th>
                  <th className="num">誤った情報</th>
                </tr>
              </thead>
              <tbody>
                {v.byEngine.map((e) => (
                  <tr key={e.engine}>
                    <td>{e.label}</td>
                    <td className="num">{e.appearance.n ? `${pctNum(e.appearance.value)}%` : "—"}</td>
                    <td className="num">{e.accuracy.n ? `${pctNum(e.accuracy.value)}%` : "—"}</td>
                    <td className="num">{e.misinfo ? <span className="verdict bad">{e.misinfo}件</span> : <span className="faint">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small faint">AIごとの数字は回答数が少ないため、揺れが大きくなります（1つのAIあたり約{Math.round(v.appearance.n / Math.max(1, v.byEngine.length))}回）。</p>
        </section>

        <section className="r-section" aria-labelledby="s-points">
          <header>
            <h2 id="s-points">今週の要点</h2>
          </header>
          <ul className="points">
            {v.highlights.map((h) => (
              <li key={h} className={h.includes("古い情報") ? "old" : h.includes("誤って") ? "bad" : ""}>
                {h}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
