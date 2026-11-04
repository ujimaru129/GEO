import type { AppConfig, FactKeys, PlansConfig } from "../config.ts";
import { isDue } from "../plans.ts";
import type { Client } from "../questions/index.ts";
import type { ReportClient } from "../report/types.ts";

/** 次の計測日（日本時間）。単発プランは null（受注時に手動） */
export function nextRunDate(planName: string, plans: PlansConfig, from: Date): string | null {
  const plan = plans.plans[planName];
  if (!plan || plan.frequency === "once") return null;
  for (let i = 0; i < 40; i++) {
    const d = new Date(from.getTime() + i * 86400_000);
    if (isDue(plan.frequency, d, plans.calendar) || isDue(plan.priority_frequency, d, plans.calendar)) {
      return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
    }
  }
  return null;
}

export function reportClient(client: Client, industry: string, config: AppConfig): ReportClient {
  const plan = config.plans.plans[client.plan];
  return {
    id: client.id,
    name: client.name,
    plan: client.plan,
    planLabel: plan?.label.replace(/（.*）/, "") ?? client.plan,
    industry,
    report: plan?.report ?? "summary",
    humanSupport: plan?.human_support ?? false,
    trials: plan?.trials ?? 0,
  };
}

export function factLabelsFor(industry: string, factKeys: FactKeys): Record<string, string> {
  return Object.fromEntries(Object.entries(factKeys[industry] ?? {}).map(([k, d]) => [k, d.label]));
}

export const INDUSTRY_LABEL: Record<string, string> = { idol: "アイドル", music: "音楽", game: "ゲーム" };

export function dedupeSources<T extends { domain: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((x) => (seen.has(x.domain) ? false : (seen.add(x.domain), true)));
}
