// 質問辞書（questions/*.yaml）と顧客・計測対象（data/entities.yaml）を検証して DB に同期する
import { loadConfig } from "../config.ts";
import { expandPrompts, loadEntities, loadQuestions } from "../questions/index.ts";
import { ROOT, openStorage, parseArgs } from "./common.ts";

const args = parseArgs(process.argv.slice(2));
const entitiesPath = typeof args.entities === "string" ? args.entities : `${ROOT}data/entities.yaml`;

const config = loadConfig();
const questions = loadQuestions(`${ROOT}questions`, config.factKeys);
const entities = loadEntities(entitiesPath, config.plans);
const prompts = expandPrompts(questions, entities, config.plans);

const { storage, label } = openStorage();
try {
  await storage.syncDictionary(questions, entities);
} finally {
  await storage.close();
}

console.log(`同期先: ${label}`);
console.log(`質問テンプレート ${questions.length} 件 / 対象 ${entities.entities.length} 件 → 展開後の質問 ${prompts.length} 件`);
for (const c of entities.clients) {
  const plan = config.plans.plans[c.plan];
  const own = prompts.filter((p) => p.clientIds.includes(c.id));
  const shared = own.filter((p) => p.clientIds.length > 1).length;
  console.log(
    `  ${c.name}（${plan.label}）: ${own.length} 問（うち他顧客と共有 ${shared} 問） / ${plan.frequency} × ${plan.trials}試行` +
      (plan.priority_frequency !== "none" ? ` / 重要 ${own.filter((p) => p.priority === "high").length} 問は ${plan.priority_frequency}` : ""),
  );
}
