import type { MeasurementConfig } from "../config.ts";

export type BudgetState = "ok" | "warn" | "stop_normal" | "stop_all";

/**
 * 月間予算の管理。
 * - 実行前に見積額を予約し、終了後に実費で精算する（並列実行中の使いすぎを防ぐ）
 * - warn_ratio で警告、100% で priority: normal を停止、hard_stop_ratio で全停止
 */
export class BudgetGuard {
  readonly capUsd: number;
  private spentUsd: number;
  private reservedUsd = 0;
  private readonly cfg: MeasurementConfig["budget"];
  private warned = false;
  private readonly onWarn: (msg: string) => void;

  constructor(cfg: MeasurementConfig["budget"], monthToDateUsd: number, onWarn: (msg: string) => void = console.warn) {
    this.cfg = cfg;
    this.capUsd = cfg.monthly_jpy / cfg.fx_jpy_per_usd;
    this.spentUsd = monthToDateUsd;
    this.onWarn = onWarn;
  }

  get ratio() {
    return (this.spentUsd + this.reservedUsd) / this.capUsd;
  }

  stateFor(extraUsd = 0): BudgetState {
    const r = (this.spentUsd + this.reservedUsd + extraUsd) / this.capUsd;
    if (r > this.cfg.hard_stop_ratio) return "stop_all";
    if (r > 1) return "stop_normal";
    if (r >= this.cfg.warn_ratio) return "warn";
    return "ok";
  }

  /** 実行してよければ見積額を予約して true */
  tryReserve(estimateUsd: number, priority: "high" | "normal"): boolean {
    const state = this.stateFor(estimateUsd);
    if (state === "stop_all" || (state === "stop_normal" && priority === "normal")) return false;
    if (state !== "ok" && !this.warned) {
      this.warned = true;
      const used = this.spentUsd + this.reservedUsd + estimateUsd;
      this.onWarn(
        `[予算] 月間予算の ${((used / this.capUsd) * 100).toFixed(0)}% に到達 ` +
          `(使用+予約 $${used.toFixed(2)} / 上限 $${this.capUsd.toFixed(2)})` +
          (state === "warn" ? "" : "。priority: normal の質問は停止します"),
      );
    }
    this.reservedUsd += estimateUsd;
    return true;
  }

  settle(reservedUsd: number, actualUsd: number) {
    this.reservedUsd -= reservedUsd;
    this.spentUsd += actualUsd;
  }

  snapshot() {
    return {
      capUsd: this.capUsd,
      spentUsd: this.spentUsd,
      capJpy: this.cfg.monthly_jpy,
      spentJpy: this.spentUsd * this.cfg.fx_jpy_per_usd,
      ratio: this.spentUsd / this.capUsd,
      state: this.stateFor(),
    };
  }
}
