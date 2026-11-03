import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { normalizeName } from "../src/normalize.ts";
import { type Entity, type Question, expandPrompts, loadEntities, loadQuestions } from "../src/questions/index.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

const ent = (e: Partial<Entity> & Pick<Entity, "id" | "role" | "type">): Entity => ({
  client_id: "self", industry: "idol", official_name: e.id, aliases: [], ambiguous: false, competitors: [], ...e,
});
const q = (x: Partial<Question> & Pick<Question, "id" | "category" | "template">): Question => ({
  industry: "idol", variables: [], fact_keys: [], priority: "normal", paraphrases: [], plans: [], ...x,
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
