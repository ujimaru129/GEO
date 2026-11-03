// 正解データ（facts）の CSV 取り込み
//   npm run facts:import -- data/facts.csv --dry-run   検証のみ（登録しない）
//   npm run facts:import -- data/facts.csv             検証してエラーがなければ登録
// CSV の列: entity_id, key, value, valid_from, valid_to, source_url, checked_at, note
// 書式は data/facts.template.csv と README を参照。エラーが1件でもあれば何も登録しない。
import { readFileSync } from "node:fs";
import { loadConfig } from "../config.ts";
import { prepareFactImport } from "../facts.ts";
import { loadEntities } from "../questions/index.ts";
import { ROOT, openStorage, parseArgs } from "./common.ts";

const args = parseArgs(process.argv.slice(2));
const path = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!path) {
  console.error("使い方: npm run facts:import -- <CSVファイル> [--dry-run]");
  process.exit(1);
}

const config = loadConfig();
const entities = loadEntities(typeof args.entities === "string" ? args.entities : `${ROOT}data/entities.yaml`, config.plans);
const now = new Date();
const batch = `facts-${now.toISOString().replace(/[:.]/g, "-")}`;

const { storage, label } = openStorage();
try {
  const result = prepareFactImport(readFileSync(path, "utf8"), {
    entities, factKeys: config.factKeys, plans: config.plans, existing: await storage.listFacts(), now, batch,
  });
  for (const w of result.warnings) console.log(`[警告] ${w}`);
  if (result.errors.length) {
    for (const e of result.errors) console.error(`[エラー] ${e}`);
    console.error(`\nエラー ${result.errors.length} 件のため、何も登録していません。CSV を直して再実行してください。`);
    process.exitCode = 1;
  } else if (args["dry-run"]) {
    console.log(`[検証OK] 新規・更新 ${result.toInsert.length} 件 / 変更なし ${result.unchanged} 件（--dry-run のため未登録）`);
  } else {
    await storage.insertFacts(result.toInsert);
    console.log(`[登録] ${label} に ${result.toInsert.length} 件を追加しました（変更なし ${result.unchanged} 件）。取り込みID: ${batch}`);
  }
} finally {
  await storage.close();
}
