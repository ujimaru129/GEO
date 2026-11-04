import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { normalizeName } from "../src/normalize.ts";
import { type Entity, type Question, expandPrompts, inPeriod, loadEntities, loadQuestions } from "../src/questions/index.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

const ent = (e: Partial<Entity> & Pick<Entity, "id" | "role" | "type">): Entity => ({
  client_id: "self", industry: "idol", official_name: e.id, aliases: [], ambiguous: false, competitors: [], contexts: {}, ...e,
});
const q = (x: Partial<Question> & Pick<Question, "id" | "category" | "template">): Question => ({
  industry: "idol", variables: [], fact_keys: [], priority: "normal", paraphrases: [], plans: [], contexts: {}, ...x,
});
const file = (entities: Entity[]) => ({ clients: [{ id: "self", name: "自社", plan: "basic" }], entities });

test("同梱の質問辞書と対象データが検証を通る", () => {
  const config = loadConfig();
  const qs = loadQuestions(`${root}questions`, config.factKeys);
  const es = loadEntities(`${root}data/entities.yaml`, config.plans);
  assert.ok(qs.length >= 30);
  assert.ok(expandPrompts(qs, es, config.plans).length >= 30); // 受け入れテストの30問を確保できる
});

test("展開: 発見は1件、指名は target のみ、比較は target×競合、言い換えは別 prompt", () => {
  const entities = [
    ent({ id: "t", role: "target", type: "group", official_name: "グループT", competitors: ["c1", "c2"] }),
    ent({ id: "c1", role: "competitor", type: "group", official_name: "グループC1" }),
    ent({ id: "c2", role: "competitor", type: "group", official_name: "グループC2" }),
    ent({ id: "m", role: "target", type: "member", official_name: "メンバーM" }),
  ];
  const prompts = expandPrompts(
    [
      q({ id: "idol-disc-001", category: "discovery", template: "おすすめは？", paraphrases: ["注目は？"] }),
      q({ id: "idol-ent-001", category: "entity", template: "{group}のメンバーは？", variables: ["group"] }),
      q({ id: "idol-cmp-001", category: "comparison", template: "{group}と{competitor}の違いは？", variables: ["group", "competitor"] }),
    ],
    file(entities),
  );
  const texts = prompts.map((p) => p.text);
  assert.deepEqual(texts, ["おすすめは？", "注目は？", "グループTのメンバーは？", "グループTとグループC1の違いは？", "グループTとグループC2の違いは？"]);
  assert.equal(new Set(prompts.map((p) => p.key)).size, prompts.length);
  assert.equal(prompts[1].variant, 1);
  assert.equal(prompts[3].competitorId, "c1");
  assert.ok(prompts.every((p) => p.clientIds.join() === "self"));
});

test("正規化: 全角半角・大小文字・カタカナひらがな・記号空白を吸収する", () => {
  assert.equal(normalizeName("Ｓａｍｐｌｅ　Ｉｄｏｌ！"), normalizeName("sample idol"));
  assert.equal(normalizeName("サンプル・アイドル"), normalizeName("さんぷる あいどる"));
  assert.equal(normalizeName("ｻﾝﾌﾟﾙ"), normalizeName("サンプル"));
  assert.equal(normalizeName("ラブライブ"), "らぶらいぶ");
  assert.equal(normalizeName("イコールラブ"), "いこーるらぶ");
});

test("条件の変数: 質問で固定した値と、計測対象に登録した値の組み合わせで展開し、登録した顧客だけが計測する", () => {
  const entities = [
    ent({ id: "a", client_id: "ca", role: "target", type: "group", contexts: { region: ["渋谷", "新宿"] } }),
    ent({ id: "b", client_id: "cb", role: "target", type: "group", contexts: { region: ["渋谷"] } }),
    ent({ id: "c", client_id: "cc", role: "target", type: "group" }),
  ];
  const f = { clients: ["ca", "cb", "cc"].map((id) => ({ id, name: id, plan: "basic" })), entities };
  const ps = expandPrompts(
    [q({ id: "idol-disc-005", category: "discovery", template: "{occasion}の{region}のアイドルイベントで一番注目されているのは？", variables: ["occasion", "region"], contexts: { occasion: ["大晦日"] } })],
    f,
  );
  assert.deepEqual(ps.map((p) => [p.text, p.clientIds.join("+")]), [
    ["大晦日の渋谷のアイドルイベントで一番注目されているのは？", "ca+cb"],
    ["大晦日の新宿のアイドルイベントで一番注目されているのは？", "ca"],
  ]);
  assert.deepEqual(ps[0].context, { occasion: "大晦日", region: "渋谷" });
  assert.notEqual(ps[0].key, ps[1].key);
  // 指名系の質問でも使える（対象ごとに、その対象の地域だけ）
  const ent2 = expandPrompts([q({ id: "idol-ent-009", category: "entity", template: "{group}の{region}での公演予定は？", variables: ["group", "region"] })], f);
  assert.deepEqual(ent2.map((p) => p.text), ["aの渋谷での公演予定は？", "aの新宿での公演予定は？", "bの渋谷での公演予定は？"]);
});

test("計測期間: 毎年（年またぎ含む）と特定の年", () => {
  assert.equal(inPeriod({ from: "12-20", to: "12-31" }, "2026-12-31"), true);
  assert.equal(inPeriod({ from: "12-20", to: "12-31" }, "2026-11-30"), false);
  assert.equal(inPeriod({ from: "12-20", to: "01-05" }, "2027-01-03"), true);
  assert.equal(inPeriod({ from: "12-20", to: "01-05" }, "2027-01-06"), false);
  assert.equal(inPeriod({ from: "2026-12-20", to: "2026-12-31" }, "2027-12-25"), false);
  assert.equal(inPeriod(undefined, "2026-01-01"), true);
});

test("同梱の業態設定: 質問・対象・正解データ項目の業態はすべて industries.yaml にある", () => {
  const config = loadConfig();
  assert.doesNotThrow(() => loadQuestions(`${root}questions`, config.factKeys, config.industries));
  assert.doesNotThrow(() => loadEntities(`${root}data/entities.yaml`, config.plans, config.industries));
  assert.equal(config.industries.game.counter, "本");
});

test("他の業態の例（飲食）: {store} は店舗の対象に、{region} は店舗に登録した地域に置き換わる", () => {
  const entities = [
    ent({ id: "s", client_id: "c1", industry: "restaurant", role: "target", type: "store", official_name: "サンプル食堂", contexts: { region: ["渋谷"] }, competitors: ["k"] }),
    ent({ id: "k", client_id: "c1", industry: "restaurant", role: "competitor", type: "store", official_name: "サンプル亭" }),
  ];
  const f = { clients: [{ id: "c1", name: "c1", plan: "basic" }], entities };
  const r = (x: Partial<Question> & Pick<Question, "id" | "category" | "template">) => q({ industry: "restaurant", ...x });
  const ps = expandPrompts(
    [
      r({ id: "food-disc-001", category: "discovery", template: "{region}でおすすめのランチは？", variables: ["region"] }),
      r({ id: "food-ent-001", category: "entity", template: "{store}の営業時間は？", variables: ["store"] }),
      r({ id: "food-cmp-001", category: "comparison", template: "{store}と{competitor}はどちらがおすすめ？", variables: ["store", "competitor"] }),
    ],
    f,
  );
  assert.deepEqual(ps.map((p) => p.text), ["渋谷でおすすめのランチは？", "サンプル食堂の営業時間は？", "サンプル食堂とサンプル亭はどちらがおすすめ？"]);
});
