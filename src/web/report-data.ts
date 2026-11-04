import { cache } from "react";
import { buildReport } from "../report/compute.ts";
import { getRepo } from "./index.ts";

/** 専用URLのトークンからレポートを組み立てる（同じリクエスト内では1回だけ計算） */
export const reportForToken = cache(async (token: string) => {
  const repo = getRepo();
  const clientId = await repo.clientIdForToken(token);
  if (!clientId) return null;
  const rows = await repo.loadReportRows(clientId);
  return { clientId, rows, view: buildReport(rows) };
});
