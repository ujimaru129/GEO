import { notFound } from "next/navigation";
import { NavLink } from "../../../components/client-ui.tsx";
import { OrbitGraphic } from "../../../components/orbit.tsx";
import { isDemo } from "../../../src/web/index.ts";
import { reportForToken } from "../../../src/web/report-data.ts";

const SUBJECT: Record<string, string> = { idol: "このグループ", music: "このアーティスト", game: "この作品" };
const dot = (ymd: string) => ymd.replaceAll("-", ".");

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const data = await reportForToken((await params).token);
  return { title: { absolute: data ? `ORBIT | ${data.view.target.name} 観測レポート` : "ORBIT | AI観測レポート" } };
}

export default async function ReportLayout({ children, params }: { children: React.ReactNode; params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await reportForToken(token);
  if (!data) notFound();
  const v = data.view;
  const base = `/r/${token}`;
  const full = v.client.report === "full";
  const once = v.client.plan === "lite";
  const weekEnd = v.period ? new Date(Date.parse(`${v.period.weekStart}T00:00:00Z`) + 6 * 86400_000).toISOString().slice(0, 10) : null;
  const tabs: { href: string; label: string; count?: number; exact?: boolean }[] = [
    { href: base, label: "概要", exact: true },
    { href: `${base}/misinfo`, label: "誤った情報", count: v.misinfoOngoing },
    { href: `${base}/competitors`, label: "競合との比較" },
    ...(full ? [{ href: `${base}/trend`, label: "推移" }, { href: `${base}/sources`, label: "引用元" }] : []),
    { href: `${base}/advice`, label: "改善の助言" },
    ...(data.rows.requests.length ? [{ href: `${base}/requests`, label: "記入のお願い", count: v.openRequests }] : []),
  ];
  return (
    <div className="orbit">
      {isDemo() && <div className="demo-band">DEMO DATA ― 架空のデータです。実在の団体・作品とは関係ありません。</div>}
      <header className="o-top">
        <div className="o-wrap">
          <div className="o-logo">
            <b>
              <i>◉</i>ORBIT
            </b>
            <span className="o-tag">AI OBSERVATORY / JP</span>
          </div>
          <div className="o-client">
            <span>{v.client.name} 様</span>
            <span className="o-tag">PLAN / {v.client.planLabel}</span>
          </div>
        </div>
      </header>

      <section className="o-hero">
        <div className="o-wrap">
          <div>
            <span className="o-tag">
              <em>●</em>　観測レポート　/　{once ? "SINGLE OBSERVATION" : v.period ? `WEEK ${v.period.weekNo}` : "準備中"}
            </span>
            <h1>{v.target.name}</h1>
            <p>生成AIは、{SUBJECT[v.client.industry] ?? "この対象"}をどう語っているか。</p>
            {v.period && weekEnd && (
              <div className="o-meta o-tag">
                <span>{once ? `${dot(v.period.lastRunDate)} 観測` : `${dot(v.period.weekStart)} — ${dot(weekEnd).slice(5)}`}</span>
                <span>4エンジン × {v.period.trials}回</span>
                <span>{v.period.runs}回答</span>
              </div>
            )}
          </div>
          {v.hasData && (
            <div className="o-orbit-box">
              <OrbitGraphic engines={v.byEngine.map((e) => ({ engine: e.engine, rate: e.appearance.n ? e.appearance.value : null }))} />
              <p className="o-legend">軌道 = AI ／ 位置 = おすすめに出た割合（真上が0%、1周で100%）</p>
            </div>
          )}
        </div>
      </section>

      <nav className="o-nav" aria-label="レポートの項目">
        <div className="o-wrap">
          {tabs.map((t, i) => (
            <NavLink key={t.href} href={t.href} exact={t.exact}>
              <span className="n">{String(i + 1).padStart(2, "0")}</span>
              {t.label}
              {!!t.count && <span className="count">{t.count}</span>}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="o-wrap o-body">{children}</main>
    </div>
  );
}
