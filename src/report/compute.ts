// 計測・解析の行データから、顧客レポートに出す数字を作る（DB でもデモでも同じ計算を通す）
import type { EngineName } from "../config.ts";
import { type FactRecord, factAt } from "../facts.ts";
import { type Metric, isoWeekNumber, jstDate, jstWeekStart, metric } from "./stats.ts";
import {
  ENGINE_LABEL,
  type RAdvice,
  type RClaim,
  type REntity,
  type RReview,
  type ReportRows,
  type SourceType,
  type Verdict,
} from "./types.ts";

const ENGINES: EngineName[] = ["openai", "gemini", "perplexity", "claude"];

/** 顧客に見せる判定。「誤り」は社内の確認が済むまで出さない（null = 確認待ち） */
export function publishedVerdict(claim: RClaim, review: RReview | undefined): Verdict | null {
  if (review) return review.decision;
  return claim.verdict === "incorrect" ? null : claim.verdict;
}

export function latestReviews(reviews: RReview[]): Map<string, RReview> {
  const m = new Map<string, RReview>();
  for (const r of reviews) {
    const prev = m.get(r.claimId);
    if (!prev || r.reviewedAt > prev.reviewedAt) m.set(r.claimId, r);
  }
  return m;
}

export function formatFactValue(value: unknown): string {
  if (Array.isArray(value)) return value.join("・");
  if (value && typeof value === "object" && "title" in value) {
    const v = value as { title: string; date: string };
    return `「${v.title}」${v.date.replaceAll("-", "/")}`;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll("-", "/");
  if (value === "active") return "サービス中";
  if (value === "end_announced") return "終了告知済み";
  if (value === "ended") return "サービス終了";
  return String(value);
}

export type MisinfoItem = {
  key: string;
  verdict: "incorrect" | "outdated";
  factKey: string;
  factLabel: string;
  statement: string;
  truth: string | null;
  evidence: string;
  engines: EngineName[];
  /** 最新週で、この主張が出た回数 / その項目を聞いた回数 */
  latestCount: number;
  latestN: number;
  firstSeen: string;
  lastSeen: string;
  ongoing: boolean;
  sources: { domain: string; sourceType: SourceType; count: number }[];
  review: RReview | null;
};

export type ReportView = {
  client: ReportRows["client"];
  target: REntity;
  hasData: boolean;
  period: { weekStart: string; weekNo: number; lastRunDate: string; runs: number; trials: number } | null;
  appearance: Metric;
  share: Metric;
  accuracy: Metric;
  misinfoOngoing: number;
  outdatedOngoing: number;
  byEngine: { engine: EngineName; label: string; appearance: Metric; accuracy: Metric; misinfo: number }[];
  highlights: string[];
  misinfo: MisinfoItem[];
  competitors: { entity: REntity; isTarget: boolean; rate: Metric }[];
  trend: { weekStart: string; weekNo: number; share: number | null; appearance: number | null; accuracy: number | null }[];
  sources: { domain: string; sourceType: SourceType; count: number; share: number }[];
  officialShare: number | null;
  citationTotal: number;
  advice: RAdvice | null;
  openRequests: number;
  /** 条件別（地域・時期など）の集計。条件付きの質問がなければ空 */
  contexts: { groups: ContextGroup[]; dimensions: ContextDimension[] };
};

export function buildReport(rows: ReportRows): ReportView {
  const reviews = latestReviews(rows.reviews);
  const runById = new Map(rows.runs.map((r) => [r.id, r]));
  const okRuns = rows.runs.filter((r) => r.status === "ok");
  const weeks = [...new Set(okRuns.map((r) => jstWeekStart(r.executedAt)))].sort();
  const latestWeek = weeks.at(-1) ?? null;
  const prevWeek = weeks.at(-2) ?? null;
  const inWeek = (w: string | null) => okRuns.filter((r) => w !== null && jstWeekStart(r.executedAt) === w);
  const mentionsByRun = new Map<string, Set<string>>();
  for (const m of rows.mentions) {
    if (!mentionsByRun.has(m.runId)) mentionsByRun.set(m.runId, new Set());
    mentionsByRun.get(m.runId)!.add(m.entityId);
  }
  const tracked = [rows.target, ...rows.competitors];
  const trackedIds = new Set(tracked.map((e) => e.id));

  // 全体の数字は条件なしの質問だけで集計する（条件付きの質問は季節で出入りし、週ごとの比較を揺らすため「条件別」で見る）
  const discovery = (runs: typeof okRuns, engine?: EngineName) =>
    runs.filter((r) => r.category === "discovery" && !hasContext(r) && (!engine || r.engine === engine));
  const appearCount = (runs: typeof okRuns, entityId: string) => ({
    successes: runs.filter((r) => mentionsByRun.get(r.id)?.has(entityId)).length,
    n: runs.length,
  });
  const shareCount = (runs: typeof okRuns) => {
    let mine = 0;
    let all = 0;
    for (const r of runs) {
      for (const id of mentionsByRun.get(r.id) ?? []) {
        if (!trackedIds.has(id)) continue;
        all++;
        if (id === rows.target.id) mine++;
      }
    }
    return { successes: mine, n: all };
  };
  const targetClaims = rows.claims.filter((c) => c.entityId === rows.target.id && runById.has(c.runId));
  const accuracyCount = (runs: typeof okRuns) => {
    const ids = new Set(runs.map((r) => r.id));
    let ok = 0;
    let n = 0;
    for (const c of targetClaims) {
      if (!ids.has(c.runId)) continue;
      const v = publishedVerdict(c, reviews.get(c.id));
      if (v === "correct") ok++;
      if (v === "correct" || v === "incorrect" || v === "outdated") n++;
    }
    return { successes: ok, n };
  };

  const cur = inWeek(latestWeek);
  const prev = inWeek(prevWeek);
  const appearance = metric(...spread(appearCount(discovery(cur), rows.target.id)), prevWeek ? appearCount(discovery(prev), rows.target.id) : null);
  const share = metric(...spread(shareCount(discovery(cur))), prevWeek ? shareCount(discovery(prev)) : null);
  const accuracy = metric(...spread(accuracyCount(cur)), prevWeek ? accuracyCount(prev) : null);

  // 誤情報（同じ項目・同じ主張をまとめる）
  const groups = new Map<string, RClaim[]>();
  for (const c of targetClaims) {
    const v = publishedVerdict(c, reviews.get(c.id));
    if (v !== "incorrect" && v !== "outdated") continue;
    const k = `${c.factKey}|${c.normalized}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const curIds = new Set(cur.map((r) => r.id));
  const misinfo: MisinfoItem[] = [...groups.entries()].map(([key, list]) => {
    const dates = list.map((c) => jstDate(runById.get(c.runId)!.executedAt)).sort();
    const latestList = list.filter((c) => curIds.has(c.runId));
    const askedLatest = targetClaims.filter((c) => c.factKey === list[0].factKey && curIds.has(c.runId)).length;
    const srcCount = new Map<string, { domain: string; sourceType: SourceType; count: number }>();
    const runIds = new Set(list.map((c) => c.runId));
    for (const ci of rows.citations) {
      if (!runIds.has(ci.runId)) continue;
      const s = srcCount.get(ci.domain) ?? { domain: ci.domain, sourceType: ci.sourceType, count: 0 };
      s.count++;
      srcCount.set(ci.domain, s);
    }
    const last = list.at(-1)!;
    const truthFact: FactRecord | undefined = factAt(rows.facts, rows.target.id, last.factKey, dates.at(-1)!);
    const verdicts = list.map((c) => publishedVerdict(c, reviews.get(c.id)));
    const review = list.map((c) => reviews.get(c.id)).filter((r): r is RReview => !!r).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))[0] ?? null;
    return {
      key,
      verdict: verdicts.includes("incorrect") ? "incorrect" : "outdated",
      factKey: last.factKey,
      factLabel: rows.factLabels[last.factKey] ?? last.factKey,
      statement: last.statement,
      truth: truthFact ? formatFactValue(truthFact.value) : null,
      evidence: last.evidence,
      engines: ENGINES.filter((e) => list.some((c) => runById.get(c.runId)!.engine === e)),
      latestCount: latestList.length,
      latestN: askedLatest,
      firstSeen: dates[0],
      lastSeen: dates.at(-1)!,
      ongoing: latestList.length > 0,
      sources: [...srcCount.values()].sort((a, b) => b.count - a.count).slice(0, 3),
      review,
    };
  });
  misinfo.sort((a, b) => Number(b.ongoing) - Number(a.ongoing) || Number(b.verdict === "incorrect") - Number(a.verdict === "incorrect") || b.latestCount - a.latestCount);

  const byEngine = ENGINES.map((engine) => {
    const ce = cur.filter((r) => r.engine === engine);
    const pe = prev.filter((r) => r.engine === engine);
    return {
      engine,
      label: ENGINE_LABEL[engine],
      appearance: metric(...spread(appearCount(discovery(ce), rows.target.id)), prevWeek ? appearCount(discovery(pe), rows.target.id) : null),
      accuracy: metric(...spread(accuracyCount(ce)), prevWeek ? accuracyCount(pe) : null),
      misinfo: misinfo.filter((m) => m.ongoing && m.engines.includes(engine)).length,
    };
  }).filter((e) => cur.some((r) => r.engine === e.engine));

  const competitors = tracked.map((entity) => {
    const c = appearCount(discovery(cur), entity.id);
    const p = prevWeek ? appearCount(discovery(prev), entity.id) : null;
    return { entity, isTarget: entity.id === rows.target.id, rate: metric(c.successes, c.n, p) };
  });

  const trend = weeks.map((w) => {
    const runs = inWeek(w);
    const s = shareCount(discovery(runs));
    const a = appearCount(discovery(runs), rows.target.id);
    const acc = accuracyCount(runs);
    return {
      weekStart: w,
      weekNo: isoWeekNumber(w),
      share: s.n ? s.successes / s.n : null,
      appearance: a.n ? a.successes / a.n : null,
      accuracy: acc.n ? acc.successes / acc.n : null,
    };
  });

  const curCitations = rows.citations.filter((c) => curIds.has(c.runId));
  const byDomain = new Map<string, { domain: string; sourceType: SourceType; count: number }>();
  for (const c of curCitations) {
    const s = byDomain.get(c.domain) ?? { domain: c.domain, sourceType: c.sourceType, count: 0 };
    s.count++;
    byDomain.set(c.domain, s);
  }
  const sources = [...byDomain.values()]
    .sort((a, b) => b.count - a.count)
    .map((s) => ({ ...s, share: curCitations.length ? s.count / curCitations.length : 0 }));
  const officialShare = curCitations.length ? curCitations.filter((c) => c.sourceType === "official").length / curCitations.length : null;

  const ongoing = misinfo.filter((m) => m.ongoing);
  const highlights: string[] = [];
  for (const m of ongoing.slice(0, 2)) {
    highlights.push(
      `${m.engines.map((e) => ENGINE_LABEL[e]).join("・")} が${m.factLabel}を${m.verdict === "outdated" ? "古い情報で" : "誤って"}回答（今週 ${m.latestCount}/${m.latestN} 回）`,
    );
  }
  if (appearance.change === "up") highlights.push(`おすすめ系の質問での出現率が上昇（${pct(appearance.prev)} → ${pct(appearance.value)}）`);
  if (appearance.change === "down") highlights.push(`おすすめ系の質問での出現率が低下（${pct(appearance.prev)} → ${pct(appearance.value)}）`);
  const silent = byEngine.filter((e) => e.appearance.n > 0 && e.appearance.successes === 0);
  if (silent.length) highlights.push(`${silent.map((e) => e.label).join("・")} のおすすめには一度も挙がっていません`);
  if (!ongoing.length && cur.length) highlights.push("今週、誤った情報・古い情報は見つかりませんでした");

  const contexts = buildContextBreakdown(okRuns.filter((r) => r.category === "discovery" && hasContext(r)), mentionsByRun, rows.target, tracked);

  const advice = rows.advice.filter((a) => a.status === "approved").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const latestRun = cur.map((r) => r.executedAt).sort().at(-1);

  return {
    client: rows.client,
    target: rows.target,
    hasData: cur.length > 0,
    period: latestWeek
      ? { weekStart: latestWeek, weekNo: isoWeekNumber(latestWeek), lastRunDate: jstDate(latestRun!), runs: cur.length, trials: rows.client.trials }
      : null,
    appearance,
    share,
    accuracy,
    misinfoOngoing: ongoing.length,
    outdatedOngoing: ongoing.filter((m) => m.verdict === "outdated").length,
    byEngine,
    highlights: highlights.slice(0, 4),
    misinfo,
    competitors,
    trend,
    sources,
    officialShare,
    citationTotal: curCitations.length,
    advice,
    openRequests: rows.requests.filter((r) => r.status === "open").length,
    contexts,
  };
}

const hasContext = (r: { context?: Record<string, string> }) => Object.keys(r.context ?? {}).length > 0;

export const CONTEXT_LABEL: Record<string, string> = { region: "地域", occasion: "時期・イベント", platform: "プラットフォーム", genre: "ジャンル" };

export type ContextGroup = {
  key: string;
  context: Record<string, string>;
  /** 直近に観測した週と、その週の最終観測日 */
  weekStart: string;
  lastDate: string;
  appearance: Metric;
  share: Metric;
  leader: { name: string; rate: number } | null;
  competitors: { entity: REntity; isTarget: boolean; rate: Metric }[];
};

export type ContextDimension = {
  variable: string;
  label: string;
  values: { value: string; weekStart: string; appearance: Metric; share: Metric }[];
};

/**
 * 条件別（地域・時期など）の集計。条件の組み合わせごとに、その条件を直近で観測した週の数字を出す
 * （イベントの質問は期間中しか計測しないため、週は組み合わせごとに異なる）。前回比はその組み合わせの前の観測週と比べる。
 */
export function buildContextBreakdown(
  runs: { id: string; executedAt: string; context: Record<string, string> }[],
  mentionsByRun: Map<string, Set<string>>,
  target: REntity,
  tracked: REntity[],
): { groups: ContextGroup[]; dimensions: ContextDimension[] } {
  const trackedIds = new Set(tracked.map((e) => e.id));
  const appear = (rs: typeof runs, id: string) => ({ successes: rs.filter((r) => mentionsByRun.get(r.id)?.has(id)).length, n: rs.length });
  const share = (rs: typeof runs) => {
    let mine = 0;
    let all = 0;
    for (const r of rs) for (const id of mentionsByRun.get(r.id) ?? []) if (trackedIds.has(id)) (all++, id === target.id && mine++);
    return { successes: mine, n: all };
  };
  const latestAndPrev = (rs: typeof runs) => {
    const weeks = [...new Set(rs.map((r) => jstWeekStart(r.executedAt)))].sort();
    const w = weeks.at(-1)!;
    const p = weeks.at(-2);
    return { w, cur: rs.filter((r) => jstWeekStart(r.executedAt) === w), prev: p ? rs.filter((r) => jstWeekStart(r.executedAt) === p) : null };
  };
  const keyOf = (c: Record<string, string>) => Object.keys(c).sort().map((k) => `${k}=${c[k]}`).join(",");
  const byKey = new Map<string, typeof runs>();
  for (const r of runs) byKey.set(keyOf(r.context), [...(byKey.get(keyOf(r.context)) ?? []), r]);

  const groups: ContextGroup[] = [...byKey.entries()].map(([key, rs]) => {
    const { w, cur, prev } = latestAndPrev(rs);
    const comps = tracked.map((entity) => {
      const c = appear(cur, entity.id);
      return { entity, isTarget: entity.id === target.id, rate: metric(c.successes, c.n, prev ? appear(prev, entity.id) : null) };
    });
    const top = comps.filter((c) => !c.isTarget).sort((a, b) => b.rate.value - a.rate.value)[0];
    const a = appear(cur, target.id);
    const s = share(cur);
    return {
      key,
      context: rs[0].context,
      weekStart: w,
      lastDate: jstDate(cur.map((r) => r.executedAt).sort().at(-1)!),
      appearance: metric(a.successes, a.n, prev ? appear(prev, target.id) : null),
      share: metric(s.successes, s.n, prev ? share(prev) : null),
      leader: top ? { name: top.entity.name, rate: top.rate.value } : null,
      competitors: comps,
    };
  });
  groups.sort((x, y) => y.weekStart.localeCompare(x.weekStart) || y.appearance.value - x.appearance.value);

  const variables = [...new Set(runs.flatMap((r) => Object.keys(r.context)))].sort();
  const dimensions: ContextDimension[] = variables.map((variable) => {
    const vals = [...new Set(runs.map((r) => r.context[variable]).filter((x): x is string => !!x))];
    return {
      variable,
      label: CONTEXT_LABEL[variable] ?? variable,
      values: vals
        .map((value) => {
          const { w, cur, prev } = latestAndPrev(runs.filter((r) => r.context[variable] === value));
          const a = appear(cur, target.id);
          const s = share(cur);
          return { value, weekStart: w, appearance: metric(a.successes, a.n, prev ? appear(prev, target.id) : null), share: metric(s.successes, s.n, prev ? share(prev) : null) };
        })
        .sort((x, y) => y.appearance.value - x.appearance.value),
    };
  });
  return { groups, dimensions };
}

const spread = (c: { successes: number; n: number }): [number, number] => [c.successes, c.n];
export const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
