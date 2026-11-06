import { notFound } from "next/navigation";
import { type MetricCardData, MetricCards } from "../../../components/client-ui.tsx";
import { deltaText, pctNum } from "../../../components/format.ts";
import { OrbitGraphic } from "../../../components/orbit.tsx";
import { ENGINE_COLOR, Module } from "../../../components/rack.tsx";
import type { Metric } from "../../../src/report/stats.ts";
import { reportForToken } from "../../../src/web/report-data.ts";

function card(id: string, title: string, m: Metric, color: string, detail: string): MetricCardData {
  return {
    id,
    title,
    value: m.n ? String(pctNum(m.value)) : "—",
    unit: m.n ? "%" : "",
    sub: m.n ? `95%区間 ${pctNum(m.low)}–${pctNum(m.high)} · n=${m.n}` : "データなし",
    delta: deltaText(m),
    track: m.value,
    ci: m.n ? [m.low, m.high] : undefined,
    color,
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
    card("SHARE", "推薦", v.share, "var(--cyan)", `おすすめを聞く質問で、競合を含む言及のうち${v.target.name}が占める割合です。${changeSentence(v.share)}`),
    card("ACCURACY", "正確性", v.accuracy, "var(--green)", `登録いただいた正しい情報と照らし合わせて、AIが正しく答えた割合です。${changeSentence(v.accuracy)}`),
    {
      id: "ISSUES",
      title: "継続中の誤情報",
      value: String(v.misinfoOngoing),
      unit: "件",
      sub: `うち古い情報 ${v.outdatedOngoing}件`,
      delta: null,
      track: v.misinfo.length ? v.misinfoOngoing / v.misinfo.length : 0,
      color: v.misinfoOngoing > 0 ? "var(--pink)" : "var(--green)",
      detail: ongoing.length
        ? `今週も観測された誤情報は${ongoing.length}件で、うち${v.outdatedOngoing}件が古い情報です。対象は${[...new Set(ongoing.map((m) => m.factLabel))].join("・")}に関する回答です。詳しくは「誤情報」をご覧ください。`
        : "今週は、誤った情報・古い情報は観測されませんでした。",
    },
  ];
  return (
    <>
      <div className="rk-grid">
        <div className="rk-col">
          <Module id="s-meters" title="今週の結果" tag="METERS" accent="cyan" right="つまみを押すと説明">
            <MetricCards cards={cards} />
          </Module>
          <Module id="s-matrix" title="AIごとの結果" tag="ENGINE MATRIX" accent="violet">
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
                      <td>
                        <span className="rk-dot" style={{ color: ENGINE_COLOR[e.engine] }} />
                        {e.label}
                      </td>
                      <td className="num">{e.appearance.n ? `${pctNum(e.appearance.value)}%` : "—"}</td>
                      <td className="num">{e.accuracy.n ? `${pctNum(e.accuracy.value)}%` : "—"}</td>
                      <td className="num" style={{ color: e.misinfo ? "var(--pink)" : "var(--text-3)" }}>
                        {e.misinfo}件
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="o-foot">AI別の数値は回答数が少なく、変動が大きくなります（1エンジンあたり約{Math.round(v.appearance.n / Math.max(1, v.byEngine.length))}回）。</p>
          </Module>
        </div>

        <div className="rk-col">
          <Module id="s-scope" title="推薦の軌道" tag="ORBIT SCOPE" accent="blue">
            <div className="rk-scope">
              <OrbitGraphic engines={v.byEngine.map((e) => ({ engine: e.engine, rate: e.appearance.n ? e.appearance.value : null }))} />
            </div>
            <p className="rk-legend">軌道 = AI ／ 位置 = おすすめに出た割合（真上が0%、1周で100%）</p>
          </Module>
          <Module id="s-log" title="今週の要点" tag="SIGNAL LOG" accent="pink">
            <div className="rk-fx">
              {ongoing.slice(0, 3).map((m, i) => (
                <div key={m.key} className="rk-fx-row" data-accent={m.verdict === "outdated" ? "yellow" : "pink"}>
                  <b>
                    #{i + 1}　{m.factLabel}
                    {m.verdict === "outdated" ? "（古い情報）" : "（誤り）"}
                  </b>
                  <span>{m.statement}</span>
                  <span className="o-tag">
                    {m.engines.map((e) => v.byEngine.find((x) => x.engine === e)?.label ?? e).join(" · ")}　今週 {m.latestCount}/{m.latestN} 回
                  </span>
                </div>
              ))}
              {v.share.change && v.share.change !== "flat" && (
                <div className="rk-fx-row" data-accent="cyan">
                  <b>推薦の変化</b>
                  <span>
                    シェア・オブ・AIが{v.share.change === "up" ? "上昇" : "低下"}（{pctNum(v.share.prev ?? 0)}% → {pctNum(v.share.value)}%）
                  </span>
                </div>
              )}
              {ongoing.length === 0 && (
                <div className="rk-fx-row" data-accent="green">
                  <b>異常なし</b>
                  <span>今週は、誤った情報・古い情報は観測されませんでした。</span>
                </div>
              )}
            </div>
          </Module>
        </div>
      </div>
      <p className="o-foot">
        推薦は「おすすめを聞く質問」で、競合を含めた言及のうち{v.target.name}が占める割合です。つまみの薄い帯は95%区間（AIの回答の揺れを考えた幅）で、前回の値がこの幅の中にあるときは「変化なし」と表示しています。
      </p>
    </>
  );
}
