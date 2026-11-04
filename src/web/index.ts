import { loadConfig } from "../config.ts";
import type { Repo } from "./repo.ts";
import { DemoRepo } from "./repo-demo.ts";
import { PgRepo } from "./repo-pg.ts";

const g = globalThis as unknown as { __geoRepo?: Repo };

/**
 * DATABASE_URL があれば本番（Postgres）、なければデモデータ。
 * デモは開発中の確認用で、社内画面にもログインなしで入れるため、本番環境では必ず DATABASE_URL を設定する。
 */
export function getRepo(): Repo {
  if (!g.__geoRepo) {
    const config = loadConfig(`${process.cwd()}/config`);
    const url = process.env.DATABASE_URL;
    g.__geoRepo = url ? new PgRepo(url, config) : new DemoRepo(config);
  }
  return g.__geoRepo;
}

export const isDemo = () => !process.env.DATABASE_URL;
