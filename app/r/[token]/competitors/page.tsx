import { notFound } from "next/navigation";
import { CiBars } from "../../../../components/charts.tsx";
import { pctNum } from "../../../../components/format.ts";
import { reportForToken } from "../../../../src/web/report-data.ts";

export const metadata = { title: "競合との比較" };

export default async function Competitors({ params }: { params: Promise<{ token: string }> }) {
  const data = await reportForToken((await params).token);
  if (!data) notFound();
  const v = data.view;
  const rows = [...v.competitors].sort((a, b) => b.rate.value - a.rate.value);
  const leader = rows[0];
  const me = rows.find((r) => r.isTarget)!;
  const overlap = leader && !leader.isTarget && me.rate.high >= leader.rate.low;
  return (
    <>
      <section className="r-section" data-accent="violet" aria-labelledby="s-comp">
        <span className="o-tag">COMPETITIVE POSITION</span>
        <header>
          <h2 id="s-comp">おすすめに挙がる割合</h2>
          <span className="small muted mono">4エンジン合計 ・ n={me.rate.n}</span>
        </header>
        <p className="lead">
          「おすすめは？」のような質問に対して、各{v.client.noun}が回答に挙がった割合です。細い線は95%区間で、線どうしが重なっている場合は差があるとは言い切れません。
        </p>
        <CiBars rows={rows.map((r) => ({ name: r.entity.name, me: r.isTarget, m: r.rate }))} />
        {leader && !leader.isTarget && (
          <p className="small muted">
            最も多く挙がったのは{leader.entity.name}（{pctNum(leader.rate.value)}%）。{v.target.name}との差は
            {overlap ? "区間が重なっており、はっきりした差とは言えません。" : "区間が重ならず、はっきりした差があります。"}
          </p>
        )}
      </section>
      <section className="r-section" data-accent="violet" aria-labelledby="s-share">
        <span className="o-tag">SHARE OF AI</span>
        <header>
          <h2 id="s-share">シェア・オブ・AI</h2>
        </header>
        <p className="lead">
          {v.target.name}と競合{v.competitors.length}{v.client.counter}への言及の合計のうち、{v.target.name}が占める割合は <b className="mono">{pctNum(v.share.value)}%</b> です。
        </p>
      </section>
    </>
  );
}
