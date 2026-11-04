import { md, yen } from "../../../components/format.ts";
import { getRepo } from "../../../src/web/index.ts";

export const metadata = { title: "顧客一覧" };

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];
const dayLabel = (ymd: string) => `${md(ymd)}（${WEEKDAY[new Date(`${ymd}T00:00:00Z`).getUTCDay()]}）`;

export default async function Clients() {
  const repo = getRepo();
  const [clients, runs] = await Promise.all([repo.listClients(), repo.runsOverview()]);
  const todo = (c: (typeof clients)[number]) => c.pendingReviews + c.pendingAdvice + c.pendingSubmissions;
  const sorted = [...clients].sort((a, b) => todo(b) - todo(a) || b.monthCostJpy / b.capJpy - a.monthCostJpy / a.capJpy);
  return (
    <>
      <div className="c-title">
        <h1>顧客一覧</h1>
        <span className="meta">
          今月の原価 {yen(runs.monthCostJpy)} / 上限 {yen(runs.monthCapJpy)}
        </span>
      </div>
      <section className="c-section">
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>顧客</th>
                <th>計測対象</th>
                <th>プラン</th>
                <th>次回計測</th>
                <th className="num">今月の原価 / 上限</th>
                <th className="num">欠損率</th>
                <th>対応が必要なこと</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const ratio = c.capJpy ? c.monthCostJpy / c.capJpy : 0;
                const items = [
                  c.pendingReviews && `誤り判定の確認 ${c.pendingReviews}`,
                  c.pendingAdvice && `助言の確認 ${c.pendingAdvice}`,
                  c.pendingSubmissions && `顧客の記入 ${c.pendingSubmissions}`,
                  !c.linkActive && "専用URL未発行",
                ].filter(Boolean) as string[];
                return (
                  <tr key={c.id}>
                    <td>
                      <a href={`/console/clients/${c.id}`}>{c.name}</a>
                    </td>
                    <td>
                      {c.targetName}
                      <span className="faint small">（{c.industryLabel}）</span>
                    </td>
                    <td>{c.planLabel}</td>
                    <td className="mono nowrap">{c.nextRun ? dayLabel(c.nextRun) : <span className="faint">受注時</span>}</td>
                    <td className="num">
                      <span className={`meter${ratio >= 1 ? " over" : ratio >= 0.8 ? " warn" : ""}`} aria-hidden>
                        <i style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                      </span>
                      {yen(c.monthCostJpy)} / {yen(c.capJpy)}
                    </td>
                    <td className="num">{c.missingRate === null ? "—" : `${(c.missingRate * 100).toFixed(1)}%`}</td>
                    <td>
                      {items.length ? (
                        items.map((t) => (
                          <span key={t} className="todo small" style={{ display: "block" }}>
                            {t}
                          </span>
                        ))
                      ) : (
                        <span className="faint small">なし</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small faint">原価の上限は1社あたりの月額です。80%を超えると黄、100%で赤になり、その顧客の計測は止まります。</p>
      </section>
    </>
  );
}
