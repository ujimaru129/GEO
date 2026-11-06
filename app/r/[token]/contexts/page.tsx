import { notFound } from "next/navigation";
import { CiBars } from "../../../../components/charts.tsx";
import { deltaText, md, pctNum } from "../../../../components/format.ts";
import { CONTEXT_LABEL } from "../../../../src/report/compute.ts";
import type { Metric } from "../../../../src/report/stats.ts";
import { reportForToken } from "../../../../src/web/report-data.ts";

export const metadata = { title: "条件別" };

const weekEnd = (ws: string) => new Date(Date.parse(`${ws}T00:00:00Z`) + 6 * 86400_000).toISOString().slice(0, 10);

function Rate({ m }: { m: Metric }) {
  if (!m.n) return <span className="faint">—</span>;
  const d = deltaText(m);
  return (
    <span style={{ display: "grid", justifyItems: "end" }}>
      <span>{pctNum(m.value)}%</span>
      <span className="o-sub">
        {pctNum(m.low)}–{pctNum(m.high)} · n={m.n}
      </span>
      {d && d.cls !== "flat" && <span className={`o-delta ${d.cls}`}>{d.cls === "up" ? "▲" : "▼"} 前回 {pctNum(m.prev ?? 0)}%</span>}
    </span>
  );
}

export default async function Contexts({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await reportForToken(token);
  if (!data) notFound();
  const v = data.view;
  const { groups, dimensions } = v.contexts;
  if (groups.length === 0) notFound();
  const latestWeek = groups.map((g) => g.weekStart).sort().at(-1)!;
  return (
    <>
      <section className="r-section" data-accent="blue" aria-labelledby="s-ctx">
        <span className="o-tag">CONDITIONS / 条件の組み合わせ</span>
        <header>
          <h2 id="s-ctx">条件ごとの結果</h2>
          <span className="small muted">地域・時期などを入れた「おすすめ」の質問</span>
        </header>
        <p className="lead">
          「渋谷で今週末おすすめのアイドルライブは？」のように、条件を入れた質問への回答に{v.target.name}が挙がった割合です。イベントの質問はその時期だけ計測するため、条件ごとに直近の観測週の数字を表示しています。概要の数字には含めていません。
        </p>
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>条件</th>
                <th>観測週</th>
                <th className="num">おすすめに出た割合</th>
                <th className="num">シェア・オブ・AI</th>
                <th>最も挙がった競合</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} style={g.weekStart < latestWeek ? { color: "var(--text-3)" } : undefined}>
                  <td>
                    <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {Object.entries(g.context).map(([k, val]) => (
                        <span key={k} className="flag ai" title={CONTEXT_LABEL[k] ?? k}>
                          {val}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="mono nowrap small">
                    {md(g.weekStart)}–{md(weekEnd(g.weekStart))}
                    {g.weekStart < latestWeek && <span className="faint"> （過去）</span>}
                  </td>
                  <td className="num">
                    <Rate m={g.appearance} />
                  </td>
                  <td className="num">
                    <Rate m={g.share} />
                  </td>
                  <td className="small">{g.leader ? `${g.leader.name}（${pctNum(g.leader.rate)}%）` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {dimensions.map((d) => (
        <section key={d.variable} className="r-section" data-accent="blue" aria-labelledby={`s-dim-${d.variable}`}>
          <span className="o-tag">BY {d.variable.toUpperCase()} / {d.label}別</span>
          <header>
            <h2 id={`s-dim-${d.variable}`}>{d.label}ごとの、おすすめに出た割合</h2>
            <span className="small muted">各{d.label}の直近の観測週 ・ 細い線は95%区間</span>
          </header>
          <CiBars rows={d.values.map((x) => ({ name: x.value, me: true, m: x.appearance }))} />
          {d.values.length > 1 && (
            <p className="small muted">
              最も高いのは{d.values[0].value}（{pctNum(d.values[0].appearance.value)}%）、最も低いのは{d.values.at(-1)!.value}（{pctNum(d.values.at(-1)!.appearance.value)}%）。
              {d.values[0].appearance.low > d.values.at(-1)!.appearance.high ? "区間が重ならず、はっきりした差があります。" : "区間が重なっており、はっきりした差とは言えません。"}
            </p>
          )}
        </section>
      ))}

      {groups[0] && (
        <section className="r-section" data-accent="blue" aria-labelledby="s-ctx-comp">
          <span className="o-tag">COMPETITION / {Object.values(groups[0].context).join(" × ")}</span>
          <header>
            <h2 id="s-ctx-comp">
              {Object.values(groups[0].context).join(" × ")} での競合との比較
            </h2>
            <span className="small muted">
              {md(groups[0].weekStart)}週 ・ n={groups[0].appearance.n}
            </span>
          </header>
          <CiBars rows={[...groups[0].competitors].sort((a, b) => b.rate.value - a.rate.value).map((c) => ({ name: c.entity.name, me: c.isTarget, m: c.rate }))} />
        </section>
      )}
    </>
  );
}
