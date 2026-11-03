import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { type FactRecord, currentFacts, factAt, parseCsv, prepareFactImport } from "../src/facts.ts";
import { loadEntities } from "../src/questions/index.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = loadConfig();
const entities = loadEntities(`${root}data/entities.yaml`, config.plans);
const now = new Date("2026-11-03T03:00:00Z");
const HEADER = "entity_id,key,value,valid_from,valid_to,source_url,checked_at,note";
const prep = (csv: string, existing: FactRecord[] = [], at = now) =>
  prepareFactImport(csv, { entities, factKeys: config.factKeys, plans: config.plans, existing, now: at, batch: "b" });

test("CSV: クォート・改行入りセル・BOM・CRLF を読める", () => {
  const rows = parseCsv('﻿a,b\r\n"x,1","改行\nあり"\r\n"引用""符",z\r\n');
  assert.deepEqual(rows, [["a", "b"], ["x,1", "改行\nあり"], ['引用"符', "z"]]);
});

test("テンプレートCSVはそのまま取り込める（型ごとに構造化される）", () => {
  const r = prep(readFileSync(`${root}data/facts.template.csv`, "utf8"));
  assert.deepEqual(r.errors, []);
  assert.equal(r.toInsert.length, 10);
  const members = r.toInsert.find((f) => f.key === "current_members" && f.validTo === null)!;
  assert.deepEqual(members.value, ["山田花子", "佐藤美咲", "鈴木愛", "高橋結衣"]);
  assert.deepEqual(r.toInsert.find((f) => f.key === "latest_release")!.value, { title: "サンプルシングル", date: "2026-10-15" });
});

test("入力ミスはすべて行番号付きのエラーにし、1件もあれば何も登録しない", () => {
  const r = prep([
    HEADER,
    "nobody,agency,X,,,https://a.example,2026-11-01,",
    "idol-t1,unknown_key,X,,,https://a.example,2026-11-01,",
    "idol-t1,formed_on,2023/01/15,,,https://a.example,2026-11-01,",
    "idol-t1,agency,X,,,ftp://a.example,2026-11-01,",
    "idol-t1,agency,X,,,https://a.example,2026-12-01,",
    "game-t1,service_status,closed,,,https://a.example,2026-11-01,",
    "idol-t1,latest_release,タイトルのみ,,,https://a.example,2026-11-01,",
    "idol-t1,agency,X,2026-01-01,2025-01-01,https://a.example,2026-11-01,",
  ].join("\n"));
  assert.equal(r.errors.length, 8);
  assert.ok(r.errors[0].startsWith("2行目"));
  assert.equal(r.toInsert.length, 0);
});

test("有効期間の重なり（古い値を閉じ忘れ）はエラー", () => {
  const r = prep([
    HEADER,
    "idol-t1,agency,旧事務所,2023-01-01,,https://a.example,2026-11-01,",
    "idol-t1,agency,新事務所,2025-04-01,,https://a.example,2026-11-01,",
  ].join("\n"));
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /有効期間が重なっています/);
});

test("更新は上書きせず追加。同じ内容の再取り込みは変更なし。閉じた期間で前の値を置き換えられる", () => {
  const first = prep([HEADER, "idol-t1,agency,旧事務所,2023-01-01,,https://a.example,2026-10-01,"].join("\n"));
  assert.equal(first.toInsert.length, 1);
  const existing = first.toInsert.map((f) => ({ ...f, createdAt: "2026-10-01T00:00:00.000Z" }));

  const same = prep([HEADER, "idol-t1,agency,旧事務所,2023-01-01,,https://a.example,2026-11-01,"].join("\n"), existing);
  assert.equal(same.unchanged, 1);
  assert.equal(same.toInsert.length, 0);

  // DB から読み戻すとオブジェクトのキー順が変わる（jsonb）。それでも変更なしと判定する
  const rel = prep([HEADER, "idol-t1,latest_release,曲|2026-10-15,2026-10-15,,https://a.example,2026-11-01,"].join("\n"));
  const reordered = rel.toInsert.map((f) => ({ ...f, value: { date: "2026-10-15", title: "曲" } }));
  assert.equal(prep([HEADER, "idol-t1,latest_release,曲|2026-10-15,2026-10-15,,https://a.example,2026-11-01,"].join("\n"), reordered).unchanged, 1);

  // 移籍: 旧事務所の期間を閉じ、新事務所を追加
  const moved = prep([
    HEADER,
    "idol-t1,agency,旧事務所,2023-01-01,2025-03-31,https://a.example,2026-11-01,",
    "idol-t1,agency,新事務所,2025-04-01,,https://b.example,2026-11-01,",
  ].join("\n"), existing);
  assert.deepEqual(moved.errors, []);
  assert.equal(moved.toInsert.length, 2);

  const all = [...existing, ...moved.toInsert];
  assert.equal(all.length, 3); // 履歴は残る
  assert.equal(currentFacts(all).length, 2);
  assert.equal(factAt(all, "idol-t1", "agency", "2024-06-01")!.value, "旧事務所"); // →「古い」判定に使う
  assert.equal(factAt(all, "idol-t1", "agency", "2026-11-03")!.value, "新事務所");
});

test("警告: 競合の正解データ・古い確認日・プラン外の項目", () => {
  const r = prep([
    HEADER,
    "idol-c1,agency,X,,,https://a.example,2026-11-01,",
    "idol-t1,formed_on,2023-01-15,,,https://a.example,2025-01-01,",
  ].join("\n"));
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.filter((w) => w.includes("競合")).length, 1);
  assert.equal(r.warnings.filter((w) => w.includes("日以上前")).length, 1);
});
