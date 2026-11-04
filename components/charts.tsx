import type { Metric } from "../src/report/stats.ts";

/** 横棒＋95%信頼区間。目盛りは 0〜100% を一つの尺度で描く */
export function CiBars({ rows }: { rows: { name: string; me: boolean; m: Metric }[] }) {
  const labelW = 190;
  const valW = 150;
  const plotW = 560;
  const rowH = 34;
  const top = 8;
  const h = top + rows.length * rowH + 26;
  const x = (v: number) => labelW + v * plotW;
  return (
    <svg className="chart" viewBox={`0 0 ${labelW + plotW + valW} ${h}`} role="img" aria-label="出現率と95%信頼区間">
      <g className="grid">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1={top - 4} y2={top + rows.length * rowH} />
        ))}
      </g>
      {rows.map((r, i) => {
        const y = top + i * rowH;
        return (
          <g key={r.name}>
            <text className={`name${r.me ? " me" : ""}`} x={0} y={y + 20}>{r.name}</text>
            <rect className={`bar${r.me ? " me" : ""}`} x={x(0)} y={y + 9} width={Math.max(1, r.m.value * plotW)} height={14} />
            {r.m.n > 0 && (
              <>
                <line className="ci" x1={x(r.m.low)} x2={x(r.m.high)} y1={y + 16} y2={y + 16} />
                <line className="ci" x1={x(r.m.low)} x2={x(r.m.low)} y1={y + 11} y2={y + 21} />
                <line className="ci" x1={x(r.m.high)} x2={x(r.m.high)} y1={y + 11} y2={y + 21} />
              </>
            )}
            <text className="val" x={labelW + plotW + 14} y={y + 20}>
              {Math.round(r.m.value * 100)}%
              <tspan dx={8}>{`(${Math.round(r.m.low * 100)}–${Math.round(r.m.high * 100)})`}</tspan>
            </text>
          </g>
        );
      })}
      {[0, 25, 50, 75, 100].map((t) => (
        <text key={t} x={x(t / 100)} y={h - 6} textAnchor={t === 0 ? "start" : t === 100 ? "end" : "middle"}>{t}%</text>
      ))}
    </svg>
  );
}

/** 週ごとの推移（折れ線）。null の週は線を切る */
export function TrendLine({ points, max = 1, label }: { points: { x: string; v: number | null }[]; max?: number; label: string }) {
  const w = 760;
  const h = 220;
  const left = 44;
  const right = 20;
  const top = 28;
  const bottom = 30;
  const pw = w - left - right;
  const ph = h - top - bottom;
  const step = points.length > 1 ? pw / (points.length - 1) : 0;
  const X = (i: number) => left + (points.length > 1 ? i * step : pw / 2);
  const Y = (v: number) => top + ph - (v / max) * ph;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const valid = points.map((p, i) => ({ ...p, i })).filter((p) => p.v !== null) as { x: string; v: number; i: number }[];
  const path = valid.map((p, k) => `${k ? "L" : "M"}${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
  const area = valid.length > 1 ? `${path} L${X(valid.at(-1)!.i)},${Y(0)} L${X(valid[0].i)},${Y(0)} Z` : "";
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <g className="grid">
        {ticks.map((t) => (
          <line key={t} x1={left} x2={w - right} y1={Y(t)} y2={Y(t)} />
        ))}
      </g>
      {ticks.map((t) => (
        <text key={t} x={left - 8} y={Y(t) + 4} textAnchor="end">{Math.round(t * 100)}%</text>
      ))}
      {area && <path className="area" d={area} opacity={0.55} />}
      {path && <path className="line" d={path} />}
      {valid.map((p, k) => (
        <g key={p.x}>
          <circle className={`dot${k === valid.length - 1 ? " last" : ""}`} cx={X(p.i)} cy={Y(p.v)} r={4} />
          <text className="val" x={X(p.i)} y={Y(p.v) - 10} textAnchor="middle">{Math.round(p.v * 100)}</text>
        </g>
      ))}
      {points.map((p, i) => (
        <text key={p.x} x={X(i)} y={h - 8} textAnchor="middle">{p.x}</text>
      ))}
    </svg>
  );
}
