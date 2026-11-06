import { jpDateTime, yen } from "../../../../components/format.ts";
import { ENGINE_LABEL } from "../../../../src/report/types.ts";
import { getRepo } from "../../../../src/web/index.ts";

export const metadata = { title: "計測とコスト" };

export default async function Runs() {
  const o = await getRepo().runsOverview();
  const ratio = o.monthCapJpy ? o.monthCostJpy / o.monthCapJpy : 0;
  const maxEngine = Math.max(1, ...o.byEngine.map((e) => e.costJpy));
  return (
    <>
      <div className="c-title">
        <h1>計測とコスト</h1>
        <span className="meta">
          今月 {yen(o.monthCostJpy)} / 全体の上限 {yen(o.monthCapJpy)}（{Math.round(ratio * 100)}%）
        </span>
      </div>
      <section className="c-section" data-accent="green">
        <header>
          <h2>今月のAPI費用（エンジン別）</h2>
        </header>
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>エンジン</th>
                <th className="num">回数</th>
                <th className="num">費用</th>
                <th className="num">1回あたり</th>
                <th style={{ width: "34%" }}></th>
              </tr>
            </thead>
            <tbody>
              {o.byEngine.map((e) => (
                <tr key={e.engine}>
                  <td>{ENGINE_LABEL[e.engine]}</td>
                  <td className="num">{e.calls.toLocaleString("ja-JP")}</td>
                  <td className="num">{yen(e.costJpy)}</td>
                  <td className="num">{e.calls ? `¥${(e.costJpy / e.calls).toFixed(1)}` : "—"}</td>
                  <td>
                    <div className="share-bar" aria-hidden>
                      <i style={{ width: `${(e.costJpy / maxEngine) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="c-section" data-accent="green">
        <header>
          <h2>計測の履歴</h2>
          <span className="small muted">欠損率の目標は2%以下</span>
        </header>
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>開始</th>
                <th>顧客</th>
                <th className="num">成功</th>
                <th className="num">失敗</th>
                <th className="num">予算停止</th>
                <th className="num">欠損率</th>
                <th className="num">費用</th>
              </tr>
            </thead>
            <tbody>
              {o.measurements.map((m) => {
                const missing = m.ok + m.failed ? m.failed / (m.ok + m.failed) : 0;
                return (
                  <tr key={m.id}>
                    <td className="mono nowrap">{jpDateTime(m.startedAt)}</td>
                    <td>{m.clientNames.join("、")}</td>
                    <td className="num">{m.ok}</td>
                    <td className="num">{m.failed || <span className="faint">0</span>}</td>
                    <td className="num">{m.skipped || <span className="faint">0</span>}</td>
                    <td className={`num${missing > 0.02 ? " todo" : ""}`}>{(missing * 100).toFixed(1)}%</td>
                    <td className="num">{yen(m.costJpy)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
