import type { EngineName } from "../src/config.ts";
import { ENGINE_COLOR } from "./rack.tsx";

const SHORT: Record<EngineName, string> = { openai: "GPT", gemini: "GEM", perplexity: "PPLX", claude: "CLD" };

/**
 * 軌道図。中心が計測対象、4本の軌道が4つのAI（AIごとの色）。
 * 惑星の位置は「おすすめに出た割合」：真上（0%）から時計回りに進み、1周で100%。
 */
export function OrbitGraphic({ engines }: { engines: { engine: EngineName; rate: number | null }[] }) {
  const W = 460;
  const H = 300;
  const cx = 230;
  const cy = 150;
  const rings = [
    { rx: 196, ry: 58, rot: -18 },
    { rx: 150, ry: 86, rot: 34 },
    { rx: 150, ry: 84, rot: -58 },
    { rx: 92, ry: 92, rot: 0 },
  ];
  return (
    <svg className="o-orbit" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="AIごとの、おすすめに出た割合を表す軌道図">
      <defs>
        <filter id="orbit-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {engines.slice(0, 4).map((e, i) => {
        const r = rings[i];
        const rate = e.rate ?? 0;
        const t = -Math.PI / 2 + rate * 2 * Math.PI;
        const px = r.rx * Math.cos(t);
        const py = r.ry * Math.sin(t);
        const a = (r.rot * Math.PI) / 180;
        const x = cx + px * Math.cos(a) - py * Math.sin(a);
        const y = cy + px * Math.sin(a) + py * Math.cos(a);
        const right = x >= cx;
        const color = ENGINE_COLOR[e.engine];
        return (
          <g key={e.engine} style={{ color }}>
            <ellipse className="ring" cx={cx} cy={cy} rx={r.rx} ry={r.ry} transform={`rotate(${r.rot} ${cx} ${cy})`} />
            {e.rate !== null && (
              <>
                <circle className="planet" cx={x} cy={y} r={5} filter="url(#orbit-glow)" />
                <text x={x + (right ? 10 : -10)} y={y + 3.5} textAnchor={right ? "start" : "end"}>
                  {SHORT[e.engine]} <tspan className="v">{Math.round(rate * 100)}%</tspan>
                </text>
              </>
            )}
          </g>
        );
      })}
      <circle className="core" cx={cx} cy={cy} r={7} filter="url(#orbit-glow)" />
    </svg>
  );
}
