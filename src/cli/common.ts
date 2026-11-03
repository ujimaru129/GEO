import { fileURLToPath } from "node:url";
import { FileStorage } from "../storage/file.ts";
import { PostgresStorage } from "../storage/postgres.ts";
import type { Storage } from "../storage/types.ts";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** DATABASE_URL があれば Supabase/Postgres、なければ data/local/ に JSONL で保存 */
export function openStorage(opts: { mock?: boolean } = {}): { storage: Storage; label: string } {
  // モック実行は本番の予算集計に混ざらないよう別の場所に保存する
  if (opts.mock) return { storage: new FileStorage(`${ROOT}data/local-mock`), label: "ローカルファイル (data/local-mock)" };
  const url = process.env.DATABASE_URL;
  if (url) return { storage: new PostgresStorage(url), label: "Postgres" };
  return { storage: new FileStorage(`${ROOT}data/local`), label: "ローカルファイル (data/local)" };
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=", 2);
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}
