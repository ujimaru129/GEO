import { notFound } from "next/navigation";
import { NavLink } from "../../../components/client-ui.tsx";
import { md, ymdSlash } from "../../../components/format.ts";
import { INDUSTRY_LABEL } from "../../../src/web/common.ts";
import { isDemo } from "../../../src/web/index.ts";
import { reportForToken } from "../../../src/web/report-data.ts";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const data = await reportForToken((await params).token);
  return { title: data ? `${data.view.target.name} のレポート` : "レポート" };
}

export default async function ReportLayout({ children, params }: { children: React.ReactNode; params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await reportForToken(token);
  if (!data) notFound();
  const v = data.view;
  const base = `/r/${token}`;
  const full = v.client.report === "full";
  const weekEnd = v.period ? new Date(Date.parse(`${v.period.weekStart}T00:00:00Z`) + 6 * 86400_000).toISOString().slice(0, 10) : null;
  return (
    <>
      {isDemo() && <div className="demo-band">デモデータを表示しています。実在の団体・作品とは関係ありません。</div>}
      <div className="report">
        <div className="r-top">
          <b>エンタメGEO</b>
          <span>
            {v.client.name} 様 ・ {v.client.planLabel}
          </span>
        </div>
        <header className="r-head">
          <span className="label">{INDUSTRY_LABEL[v.client.industry] ?? v.client.industry} ・ 生成AIでの語られ方</span>
          <h1>{v.target.name}</h1>
          {v.period && weekEnd && (
            <div className="r-meta">
              <span>第{v.period.weekNo}週 {ymdSlash(v.period.weekStart)}〜{md(weekEnd)}</span>
              <span>計測 {ymdSlash(v.period.lastRunDate)}</span>
              <span>4エンジン × {v.period.trials}回</span>
              <span>{v.period.runs}回答</span>
            </div>
          )}
        </header>
        <nav className="r-nav" aria-label="レポートの項目">
          <NavLink href={base} exact>サマリー</NavLink>
          <NavLink href={`${base}/misinfo`}>
            誤った情報{v.misinfoOngoing > 0 && <span className="count">{v.misinfoOngoing}</span>}
          </NavLink>
          <NavLink href={`${base}/competitors`}>競合との比較</NavLink>
          {full && <NavLink href={`${base}/trend`}>推移</NavLink>}
          {full && <NavLink href={`${base}/sources`}>引用元</NavLink>}
          <NavLink href={`${base}/advice`}>改善の助言</NavLink>
          {(v.openRequests > 0 || data.rows.requests.length > 0) && (
            <NavLink href={`${base}/requests`}>
              記入のお願い{v.openRequests > 0 && <span className="count">{v.openRequests}</span>}
            </NavLink>
          )}
        </nav>
        <div className="r-body">{children}</div>
      </div>
    </>
  );
}
