import { notFound } from "next/navigation";
import { NavLink } from "../../../components/client-ui.tsx";
import { ENGINE_COLOR, Icon, LedMeter } from "../../../components/rack.tsx";
import { isDemo } from "../../../src/web/index.ts";
import { reportForToken } from "../../../src/web/report-data.ts";

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
  const tabs: { href: string; label: string; icon: string; count?: number; exact?: boolean }[] = [
    { href: base, label: "概要", icon: "overview", exact: true },
    { href: `${base}/misinfo`, label: "誤情報", icon: "misinfo", count: v.misinfoOngoing },
    { href: `${base}/competitors`, label: "競合", icon: "competitors" },
    ...(v.contexts.groups.length ? [{ href: `${base}/contexts`, label: "条件別", icon: "contexts" }] : []),
    ...(full ? [{ href: `${base}/trend`, label: "推移", icon: "trend" }, { href: `${base}/sources`, label: "引用元", icon: "sources" }] : []),
    { href: `${base}/advice`, label: "助言", icon: "advice" },
    ...(data.rows.requests.length ? [{ href: `${base}/requests`, label: "記入", icon: "requests", count: v.openRequests }] : []),
  ];
  return (
    <div className="orbit">
      {isDemo() && <div className="demo-band">DEMO DATA ― 架空のデータです。実在の団体・作品とは関係ありません。</div>}
      <header className="rk-bar">
        <div className="o-wrap">
          <div className="rk-logo">
            <b>ORBIT</b>
            <span className="rk-badge" title={`${v.client.planLabel} プラン`}>
              {v.client.planLabel.slice(0, 1)}
            </span>
          </div>
          <div className="rk-preset rk-screen">
            <span className="chip">{once ? "SINGLE" : v.period ? `WK${v.period.weekNo}` : "—"}</span>
            <b>{v.target.name}</b>
            {v.period && weekEnd && (
              <span className="o-tag">
                {once ? `${dot(v.period.lastRunDate)} 観測` : `${dot(v.period.weekStart)}–${dot(weekEnd).slice(5)}`} · 4エンジン×{v.period.trials} · {v.period.runs}回答
              </span>
            )}
          </div>
          <nav className="rk-tabs rk-screen" aria-label="レポートの項目">
            {tabs.map((t) => (
              <NavLink key={t.href} href={t.href} exact={t.exact}>
                <Icon name={t.icon} />
                <span className="t">{t.label}</span>
                {!!t.count && <span className="count">{t.count}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="rk-client">
            <span>{v.client.name} 様</span>
            <span className="o-tag">{v.client.industryLabel}</span>
          </div>
        </div>
      </header>

      {v.hasData && (
        <div className="rk-strips" aria-label="AIごとの、おすすめに出た割合">
          <div className="o-wrap">
            {v.byEngine.map((e, i) => (
              <div key={e.engine} className="rk-strip" style={{ color: ENGINE_COLOR[e.engine] }}>
                <span className="name">
                  <i>{i + 1}•</i>
                  {e.label}
                </span>
                <LedMeter value={e.appearance.n ? e.appearance.value : 0} color={ENGINE_COLOR[e.engine]} />
                <span className="val">{e.appearance.n ? `${Math.round(e.appearance.value * 100)}%` : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <main className="o-wrap o-body">{children}</main>
    </div>
  );
}
