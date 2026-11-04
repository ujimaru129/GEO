import { notFound } from "next/navigation";
import { IssueLinkForm } from "../../../../../components/client-ui.tsx";
import { jpDateTime, md, yen } from "../../../../../components/format.ts";
import { getRepo, isDemo } from "../../../../../src/web/index.ts";
import { demoToken } from "../../../../../src/report/demo.ts";
import { issueLinkAction } from "../../../actions.ts";

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getRepo().clientDetail(id);
  if (!c) notFound();
  return (
    <>
      <div className="c-title">
        <h1>{c.name}</h1>
        <span className="meta">{c.planLabel} ・ {c.industryLabel}</span>
      </div>
      <section className="c-section">
        <dl className="kv">
          <dt>計測対象</dt>
          <dd>{c.targetName}</dd>
          <dt>競合</dt>
          <dd>{c.competitors.join("、") || "—"}</dd>
          <dt>前回の計測</dt>
          <dd className="mono">{c.lastRun ? md(c.lastRun) : "—"}</dd>
          <dt>次回の計測</dt>
          <dd className="mono">{c.nextRun ? md(c.nextRun) : "受注時に手動で実行"}</dd>
          <dt>今月の原価</dt>
          <dd className="mono">
            {yen(c.monthCostJpy)} / 上限 {yen(c.capJpy)}
          </dd>
        </dl>
        <div className="actions">
          <a className="btn quiet" href={`/console/facts?client=${c.id}`}>正解データを見る</a>
          <a className="btn quiet" href="/console/reviews">判定の確認へ</a>
        </div>
      </section>

      <section className="c-section">
        <header>
          <h2>顧客の専用URL</h2>
          <span className="small muted">{c.activeLinkCreatedAt ? `発行 ${jpDateTime(c.activeLinkCreatedAt)}` : "未発行"}</span>
        </header>
        <p className="small muted">
          URLは発行した直後の画面でしか確認できません（保存しているのは照合用の値だけです）。漏れた場合や紛失した場合は再発行すると、古いURLは使えなくなります。
        </p>
        {isDemo() && c.linkActive && (
          <p className="small">
            デモ用のURL: <a href={`/r/${demoToken(c.id)}`}>レポートを開く</a>
          </p>
        )}
        <IssueLinkForm action={issueLinkAction.bind(null, c.id)} active={c.linkActive} />
      </section>
    </>
  );
}
