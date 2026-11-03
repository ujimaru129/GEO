import { type EngineName, ENGINE_NAMES, type Plan, type PlansConfig, weekdayIndex } from "./config.ts";
import type { EntitiesFile, Prompt } from "./questions/index.ts";

/** 日本時間の暦情報 */
export function jstCalendar(now: Date) {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth() + 1;
  const d = jst.getUTCDate();
  const weekday = jst.getUTCDay();
  // ISO 週番号（木曜日基準）
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 4 - (weekday || 7));
  const isoWeek = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400_000 + 1) / 7);
  return { y, m, d, weekday, isoWeek, ymd: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

export function isDue(
  frequency: Plan["frequency"] | Plan["priority_frequency"],
  now: Date,
  cal: PlansConfig["calendar"],
): boolean {
  const c = jstCalendar(now);
  switch (frequency) {
    case "none":
      return false;
    case "weekly":
      return c.weekday === weekdayIndex(cal.weekly_day);
    case "twice_weekly":
      return cal.twice_weekly_days.some((d) => weekdayIndex(d) === c.weekday);
    case "biweekly":
      return c.weekday === weekdayIndex(cal.biweekly_day) && c.isoWeek % 2 === 0;
    case "monthly":
      return c.d === cal.monthly_day;
  }
}

export type SelectionMode =
  /** 定期実行。その日に計測日が来ている顧客の分だけ */
  | { kind: "scheduled"; now: Date }
  /** 手動: 全顧客の全質問 */
  | { kind: "full" }
  /** 手動: priority: high の質問（追加計測のあるプランの顧客のみ） */
  | { kind: "priority" };

export type SelectedPrompt = {
  prompt: Prompt;
  /** 計測する顧客（この回の費用を按分する相手） */
  clientIds: string[];
  /** 対象顧客のプランの最大値 */
  trials: number;
  /** 顧客ごとのプランの試行回数。共有の質問で、試行回数を超えた回の費用はその顧客に按分しない */
  clientTrials: Record<string, number>;
  /** エンジン → そのエンジンを含むプランの顧客 */
  engineClients: Partial<Record<EngineName, string[]>>;
};

export function selectPrompts(
  prompts: Prompt[],
  file: EntitiesFile,
  plans: PlansConfig,
  mode: SelectionMode,
  opts: { clients?: string[] } = {},
): SelectedPrompt[] {
  const planOf = new Map(file.clients.map((c) => [c.id, plans.plans[c.plan]]));
  const selected: SelectedPrompt[] = [];
  for (const prompt of prompts) {
    const clientIds = prompt.clientIds.filter((id) => {
      if (opts.clients && !opts.clients.includes(id)) return false;
      const plan = planOf.get(id)!;
      switch (mode.kind) {
        case "full":
          return true;
        case "priority":
          return prompt.priority === "high" && plan.priority_frequency !== "none";
        case "scheduled":
          return isDue(plan.frequency, mode.now, plans.calendar) || (prompt.priority === "high" && isDue(plan.priority_frequency, mode.now, plans.calendar));
      }
    });
    if (clientIds.length === 0) continue;
    const engineClients: SelectedPrompt["engineClients"] = {};
    for (const e of ENGINE_NAMES) {
      const ids = clientIds.filter((id) => planOf.get(id)!.engines.includes(e));
      if (ids.length) engineClients[e] = ids;
    }
    const clientTrials = Object.fromEntries(clientIds.map((id) => [id, planOf.get(id)!.trials]));
    selected.push({ prompt, clientIds, trials: Math.max(...Object.values(clientTrials)), clientTrials, engineClients });
  }
  return selected;
}
