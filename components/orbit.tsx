import type { EngineName } from "../src/config.ts";

const SHORT: Record<EngineName, string> = { openai: "GPT", gemini: "GEM", perplexity: "PPLX", claude: "CLD" };

/**
 * 軌道図。中心が計測対象、4本の軌道が4つのAI。
 * 惑星の位置は「おすすめに出た割合」：真上（0%）から時計回りに進み、1周で100%。
 */
export function OrbitGraphic({ engines }: { engines: { engine: EngineName; rate: number | null }[] }) {
  const W = 460;
  const H = 300;
  const cx = 250;
  const cy = 150;
  const rings = [
    { rx: 196, ry: 58, rot: -18 },
    { rx: 150, ry: 86, rot: 34 },
    { rx: 150, ry: 84, rot: -58 },
    { rx: 92, ry: 92, rot: 0 },
  ];
  const dots: { x: number; y: number }[] = [];
  for (let y = 7; y < H; y += 14) for (let x = 7; x < W; x += 14) dots.push({ x, y });
  return (
    <svg className="o-orbit" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="AIごとの、おすすめに出た割合を表す軌道図">
      <g>
        {dots.map((d) => (
          <circle key={`${d.x}-${d.y}`} className="grid-dot" cx={d.x} cy={d.y} r={0.9} />
        ))}
      </g>
      {engines.slice(0, 4).map((e, i) => {
        const r = rings[i];
        const rate = e.rate ?? 0;
        // 楕円上の点（真上から時計回り）を回転させて配置
        const t = -Math.PI / 2 + rate * 2 * Math.PI;
        const px = r.rx * Math.cos(t);
        const py = r.ry * Math.sin(t);
        const a = (r.rot * Math.PI) / 180;
        const x = cx + px * Math.cos(a) - py * Math.sin(a);
        const y = cy + px * Math.sin(a) + py * Math.cos(a);
        const right = x >= cx;
        return (
          <g key={e.engine}>
            <ellipse className={`ring${i === 3 ? " faint" : ""}`} cx={cx} cy={cy} rx={r.rx} ry={r.ry} transform={`rotate(${r.rot} ${cx} ${cy})`} />
            {e.rate !== null && (
              <>
                <circle className="planet" cx={x} cy={y} r={4.5} />
                <text x={x + (right ? 9 : -9)} y={y + 3.5} textAnchor={right ? "start" : "end"}>
                  {SHORT[e.engine]} <tspan className="v">{Math.round(rate * 100)}%</tspan>
                </text>
              </>
            )}
          </g>
        );
      })}
      <circle className="core" cx={cx} cy={cy} r={6} />
    </svg>
  );
}
