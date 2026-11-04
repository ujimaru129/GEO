// 画面が使うデータの窓口。DB（Postgres）とデモ（メモリ上の架空データ）で同じ形を返す。
import type { EngineName } from "../config.ts";
import type { FactInput, FactRecord } from "../facts.ts";
import type { ReportRows, RAdvice, SourceType, Verdict } from "../report/types.ts";
import type { FactRequest, FactSubmission } from "../workflow/fact-requests.ts";

export type Staff = { email: string; name: string; role: "admin" | "member" };

export type ClientOverview = {
  id: string;
  name: string;
  plan: string;
  planLabel: string;
  industry: string;
  targetName: string;
  nextRun: string | null; // YYYY-MM-DD。null = 受注時に手動
  lastRun: string | null;
  monthCostJpy: number;
  capJpy: number;
  missingRate: number | null;
  pendingReviews: number;
  pendingAdvice: number;
  openRequests: number;
  pendingSubmissions: number;
  linkActive: boolean;
};

export type ReviewItem = {
  claimId: string;
  clientId: string;
  clientName: string;
  targetName: string;
  factKey: string;
  factLabel: string;
  engine: EngineName;
  statement: string;
  evidence: string;
  truth: string | null;
  confidence: number;
  executedAt: string;
  sources: { domain: string; sourceType: SourceType }[];
};

export type FactsOverview = {
  clientId: string;
  clientName: string;
  targets: { id: string; name: string; industry: string }[];
  facts: (FactRecord & { entityName: string; factLabel: string; display: string; current: boolean })[];
  requests: (FactRequest & { entityName: string; factLabel: string; requestedByName: string })[];
  submissions: (FactSubmission & { entityName: string; factLabel: string })[];
  factKeys: { key: string; label: string; type: string; industry: string }[];
};

export type MeasurementRow = {
  id: string;
  clientNames: string[];
  scope: string;
  startedAt: string;
  planned: number;
  ok: number;
  failed: number;
  skipped: number;
  costJpy: number;
};

export type RunsOverview = {
  monthCostJpy: number;
  monthCapJpy: number;
  byEngine: { engine: EngineName; calls: number; costJpy: number }[];
  measurements: MeasurementRow[];
};

export type ClientDetail = ClientOverview & {
  competitors: string[];
  activeLinkCreatedAt: string | null;
};

export type ActionResult = { ok: true; message?: string } | { ok: false; errors: string[] };

export interface Repo {
  readonly mode: "demo" | "db";
  // 顧客側
  clientIdForToken(token: string): Promise<string | null>;
  loadReportRows(clientId: string): Promise<ReportRows>;
  clientSubmitFact(clientId: string, requestId: string, input: { value: string; validFrom?: string; publicFrom?: string; sourceUrl?: string; note?: string }): Promise<ActionResult>;
  clientAnswerUnknown(clientId: string, requestId: string): Promise<ActionResult>;
  // 社内
  staffByEmail(email: string): Promise<Staff | null>;
  listStaff(): Promise<Staff[]>;
  listClients(): Promise<ClientOverview[]>;
  clientDetail(clientId: string): Promise<ClientDetail | null>;
  /** 新しい専用URLのトークンを発行（古いものは無効化）。トークンはこの戻り値でしか分からない */
  issueLink(clientId: string, staff: Staff): Promise<{ token: string }>;
  pendingReviews(): Promise<ReviewItem[]>;
  decideClaim(claimId: string, decision: Verdict, note: string | null, staff: Staff): Promise<ActionResult>;
  adviceDrafts(): Promise<(RAdvice & { clientName: string })[]>;
  approveAdvice(adviceId: string, comment: string | null, staff: Staff): Promise<ActionResult>;
  factsOverview(clientId: string): Promise<FactsOverview | null>;
  createRequest(args: { clientId: string; entityId: string; key: string; reason: string }, staff: Staff): Promise<ActionResult>;
  approveSubmission(submissionId: string, closePrevious: boolean, staff: Staff): Promise<ActionResult>;
  rejectSubmission(submissionId: string, note: string, staff: Staff): Promise<ActionResult>;
  addStaffFact(input: FactInput, staff: Staff): Promise<ActionResult>;
  runsOverview(): Promise<RunsOverview>;
}
