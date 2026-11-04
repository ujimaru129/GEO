import { notFound } from "next/navigation";
import { type MetricCardData, MetricCards } from "../../../components/client-ui.tsx";
import { deltaText, pctNum } from "../../../components/format.ts";
import type { Metric } from "../../../src/report/stats.ts";
import { reportForToken } from "../../../src/web/report-data.ts";

function card(id: string, title: string, m: Metric, detail: string): MetricCardData {
  return {
    id,
    title,
    value: m.n ? String(pctNum(m.value)) : "—",
    unit: m.n ? "%" : "",
    sub: m.n ? `95%区間 ${pctNum(m.low)}–${pctNum(m.high)}%　·　n=${m.n}` : "データなし",
    delta: deltaText(m),
    track: m.value,
    ci: m.n ? [m.low, m.high] : undefined,
    detail,
  };
}

const changeSentence = (m: Metric) =>
  m.prev === null
    ? "前回の計測がないため、比較はまだできません。"
    : m.change === "flat"
      ? `前回の${pctNum(m.prev)}%は今回の95%区間内のため、判定は「変化なし」です。`
      : `前回の${pctNum(m.prev)}%は今回の95%区間の外にあり、${m.change === "up" ? "上昇" : "低下"}と判断しています。`;

export default async function Overview({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await reportForToken(token);
  if (!data) notFound();
  const v = data.view;
  if (!v.hasData) {
    return <p className="o-foot">まだ観測結果がありません。初回の計測が終わると、ここに結果が表示されます。</p>;
  }
  const ongoing = v.misinfo.filter((m) => m.ongoing);
  const cards: MetricCardData[] = [
    card(
      "SHARE OF AI",
      "推薦",
      v.share,
      `おすすめを聞く質問で、競合を含む言及のうち${v.target.name}が占める割合です。${changeSentence(v.share)}`,
    ),
    card("ACCURACY", "正確性", v.accuracy, `登録いただいた正しい情報と照らし合わせて、AIが正しく答えた割合です。${changeSentence(v.accuracy)}`),
    {
      id: "OPEN ISSUES",
      title: "継続中の誤情報",
      value: String(v.misinfoOngoing),
      unit: "件",
      sub: `うち古い情報 ${v.outdatedOngoing}件`,
      delta: null,
      track: v.misinfo.length ? v.misinfoOngoing / v.misinfo.length : 0,
      warm: v.misinfoOngoing > 0,
      detail: ongoing.length
        ? `今週も観測された誤情報は${ongoing.length}件で、うち${v.outdatedOngoing}件が古い情報です。対象は${[...new Set(ongoing.map((m) => m.factLabel))].join("・")}に関する回答です。詳しくは「誤った情報」をご覧ください。`
        : "今週は、誤った情報・古い情報は観測されませんでした。",
    },
  ];
  return (
    <>
      <section aria-labelledby="s-overview">
        <div className="o-bar">
          <h2 id="s-overview">今週の結果</h2>
          <span className="o-tag">01 / OVERVIEW</span>
        </div>
        <MetricCards cards={cards} />
      </section>

      <div className="o-lower">
        <article className="o-panel" aria-labelledby="s-matrix">
          <span className="o-tag">02 / ENGINE MATRIX</span>
          <h2 id="s-matrix">AIごとの結果</h2>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>エンジン</th>
                  <th className="num">推薦率</th>
                  <th className="num">正確性</th>
                  <th className="num">誤情報</th>
                </tr>
              </thead>
              <tbody>
                {v.byEngine.map((e) => (
                  <tr key={e.engine}>
                    <td>{e.label}</td>
                    <td className="num">{e.appearance.n ? `${pctNum(e.appearance.value)}%` : "—"}</td>
                    <td className="num">{e.accuracy.n ? `${pctNum(e.accuracy.value)}%` : "—"}</td>
                    <td className="num" style={e.misinfo ? { color: "var(--warm)" } : { color: "var(--text-3)" }}>
                      {e.misinfo}件
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="o-foot">AI別の数値は回答数が少なく、変動が大きくなります（1エンジンあたり約{Math.round(v.appearance.n / Math.max(1, v.byEngine.length))}回）。</p>
        </article>

        <article className="o-panel" aria-labelledby="s-log">
          <span className="o-tag">03 / SIGNAL LOG</span>
          <h2 id="s-log">今週の要点</h2>
          <div>
            {ongoing.slice(0, 3).map((m, i) => (
              <div key={m.key} className="o-note">
                <b className={m.verdict === "outdated" ? "old" : undefined}>
                  {String(i + 1).padStart(2, "0")}　{m.factLabel}
                  {m.verdict === "outdated" ? "（古い情報）" : "（誤り）"}
                </b>
                <span>
                  <span className="o-tag">{m.engines.map((e) => v.byEngine.find((x) => x.engine === e)?.label ?? e).join(" · ")}</span>　{m.statement}
                </span>
                <span className="o-tag">
                  今週 {m.latestCount} / {m.latestN} 回
                </span>
              </div>
            ))}
            {v.share.change && v.share.change !== "flat" && (
              <div className="o-note">
                <b className="ok">{String(Math.min(ongoing.length, 3) + 1).padStart(2, "0")}　推薦の変化</b>
                <span>
                  シェア・オブ・AIが{v.share.change === "up" ? "上昇" : "低下"}（{pctNum(v.share.prev ?? 0)}% → {pctNum(v.share.value)}%）
                </span>
              </div>
            )}
            {ongoing.length === 0 && (
              <div className="o-note">
                <b className="ok">01　異常なし</b>
                <span>今週は、誤った情報・古い情報は観測されませんでした。</span>
              </div>
            )}
          </div>
        </article>
      </div>

      <p className="o-foot">
        推薦は「おすすめを聞く質問」で、競合を含めた言及のうち{v.target.name}が占める割合です。95%区間はAIの回答の揺れを考えた幅で、前回の値がこの幅の中にあるときは「変化なし」と表示しています。カードを押すと説明が開きます。
      </p>
    </>
  );
}
