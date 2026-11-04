import { notFound } from "next/navigation";
import { TrendLine } from "../../../../components/charts.tsx";
import { md } from "../../../../components/format.ts";
import { reportForToken } from "../../../../src/web/report-data.ts";

export const metadata = { title: "推移" };

export default async function Trend({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await reportForToken(token);
  if (!data) notFound();
  const v = data.view;
  if (v.client.report !== "full") notFound();
  const xs = v.trend.map((t) => md(t.weekStart));
  return (
    <>
      <section className="r-section" aria-labelledby="s-t-share">
        <header>
          <h2 id="s-t-share">推薦（シェア・オブ・AI）</h2>
          <span className="small muted">週ごと ・ 横軸は週の初日</span>
        </header>
        <TrendLine label="シェア・オブ・AIの推移" points={v.trend.map((t, i) => ({ x: xs[i], v: t.share }))} max={0.5} />
      </section>
      <section className="r-section" aria-labelledby="s-t-acc">
        <header>
          <h2 id="s-t-acc">正確性（正しく答えた割合）</h2>
        </header>
        <TrendLine label="正確率の推移" points={v.trend.map((t, i) => ({ x: xs[i], v: t.accuracy }))} />
        <p className="readme">週ごとの値には回答の揺れが含まれます。前の週との差がサマリーの95%区間に収まる場合は、改善・悪化とは判断していません。</p>
      </section>
    </>
  );
}
