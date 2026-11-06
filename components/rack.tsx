// プラグイン風の共通部品（つまみ・部品・アイコン）。サーバー・クライアントどちらからでも使える
import type { EngineName } from "../src/config.ts";

/** AI ごとの色。チャンネル帯・軌道図・表で同じ色を使う */
export const ENGINE_COLOR: Record<EngineName, string> = {
  openai: "var(--ch-gpt)",
  gemini: "var(--ch-gem)",
  perplexity: "var(--ch-ppx)",
  claude: "var(--ch-cld)",
};

export type Accent = "cyan" | "pink" | "yellow" | "violet" | "green" | "orange" | "blue";

/** 部品（左端に色の帯、上部に電源マークとタイトル） */
export function Module({
  title,
  tag,
  accent = "cyan",
  right,
  children,
  className,
  id,
}: {
  title: React.ReactNode;
  tag?: string;
  accent?: Accent;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`rk-mod${className ? ` ${className}` : ""}`} data-accent={accent} aria-labelledby={id}>
      <header className="rk-mod-head">
        <span className="rk-power" aria-hidden />
        <h2 id={id}>{title}</h2>
        {tag && <span className="rk-mod-tag">{tag}</span>}
        {right && <span className="rk-mod-right">{right}</span>}
      </header>
      <div className="rk-mod-body">{children}</div>
    </section>
  );
}

/**
 * 回転つまみ。弧が値（0〜1）、薄い帯が95%区間。
 * 下端の 90° を空けた 270° の範囲で描く（DAW のつまみと同じ配置）。
 */
export function Knob({ value, low, high, color = "var(--cyan)", size = 104, label }: { value: number; low?: number; high?: number; color?: string; size?: number; label: string }) {
  const c = 60;
  const R = 46;
  const start = -225; // 左下から時計回り
  const sweep = 270;
  const pt = (t: number, r = R) => {
    const a = ((start + sweep * t) * Math.PI) / 180;
    return [c + r * Math.cos(a), c + r * Math.sin(a)] as const;
  };
  const arc = (t0: number, t1: number, r = R) => {
    const a = Math.max(0, Math.min(1, t0));
    const b = Math.max(a + 0.0001, Math.min(1, t1));
    const [x0, y0] = pt(a, r);
    const [x1, y1] = pt(b, r);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${sweep * (b - a) > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const v = Math.max(0, Math.min(1, value));
  const [px, py] = pt(v, 24);
  const gid = `kg-${label.replace(/[^a-zA-Z0-9]/g, "") || "k"}`;
  return (
    <svg className="rk-knob" width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`${label} ${Math.round(v * 100)}%`} style={{ color }}>
      <defs>
        <radialGradient id={`${gid}-cap`} cx="40%" cy="32%" r="75%">
          <stop offset="0" stopColor="#4a5260" />
          <stop offset="0.55" stopColor="#272d36" />
          <stop offset="1" stopColor="#14181e" />
        </radialGradient>
      </defs>
      {/* 目盛り */}
      {Array.from({ length: 11 }, (_, i) => {
        const [x0, y0] = pt(i / 10, 54);
        const [x1, y1] = pt(i / 10, 58);
        return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} className="rk-knob-tick" />;
      })}
      <path d={arc(0, 1)} className="rk-knob-track" />
      {low !== undefined && high !== undefined && <path d={arc(low, high)} className="rk-knob-ci" />}
      <path d={arc(0, v)} className="rk-knob-value" />
      <circle cx={c} cy={c} r={34} className="rk-knob-ring" />
      <circle cx={c} cy={c} r={31} fill={`url(#${gid}-cap)`} className="rk-knob-cap" />
      <line x1={c} y1={c} x2={px} y2={py} className="rk-knob-pointer" />
      <circle cx={px} cy={py} r={2.6} className="rk-knob-dot" />
    </svg>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  overview: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  misinfo: <path d="M12 3 22 20H2L12 3zm0 6v5m0 3v.5" />,
  competitors: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
  contexts: <path d="M12 21s-6-5.5-6-11a6 6 0 1 1 12 0c0 5.5-6 11-6 11zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />,
  trend: <path d="M3 17l5-6 4 3 5-7 4 4M3 21h18" />,
  sources: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  advice: <path d="M9 18h6m-5 3h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />,
  requests: <path d="M4 20h4L19 9l-4-4L4 16v4zm9-13 4 4" />,
  clients: <path d="M4 6h16M4 12h16M4 18h10" />,
  reviews: <path d="M5 12l4 4 10-10M4 20h16" />,
  facts: <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7" />,
  runs: <path d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2m0-12-2 2M8 16l-2 2M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />,
};

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

/** LED のメーター（0〜1）。セグメントで点灯する */
export function LedMeter({ value, segments = 16, color = "var(--cyan)" }: { value: number; segments?: number; color?: string }) {
  const on = Math.round(Math.max(0, Math.min(1, value)) * segments);
  return (
    <span className="rk-led" style={{ color }} aria-hidden>
      {Array.from({ length: segments }, (_, i) => (
        <i key={i} className={i < on ? "on" : undefined} />
      ))}
    </span>
  );
}
