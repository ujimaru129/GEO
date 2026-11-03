// 質問辞書（questions/*.yaml）と計測対象（data/entities.yaml）を検証して DB に同期する
import { loadQuestions, loadEntities, expandPrompts } from "../questions/index.ts";
import { ROOT, openStorage, parseArgs } from "./common.ts";

const args = parseArgs(process.argv.slice(2));
const entitiesPath = typeof args.entities === "string" ? args.entities : `${ROOT}data/entities.yaml`;

const questions = loadQuestions(`${ROOT}questions`);
const entities = loadEntities(entitiesPath);
const prompts = expandPrompts(questions, entities.entities);

const { storage, label } = openStorage();
try {
  await storage.syncDictionary(questions, entities);
} finally {
  await storage.close();
}

const byIndustry = Object.groupBy(prompts, (p) => p.industry);
console.log(`同期先: ${label}`);
console.log(`質問テンプレート ${questions.length} 件 / 対象 ${entities.entities.length} 件 → 展開後の質問 ${prompts.length} 件`);
for (const [ind, ps] of Object.entries(byIndustry)) {
  console.log(`  ${ind}: ${ps!.length} 件（うち priority: high ${ps!.filter((p) => p.priority === "high").length} 件）`);
}
