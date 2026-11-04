// デモ用のデータ（架空の3社）。DB 未接続でも画面を確認できるようにするためのもの。
// 実在の団体・人物・サイトと混同しないよう、名前はすべて「サンプル」、ドメインは example を使う。
import { createHash } from "node:crypto";
import type { EngineName } from "../config.ts";
import type { FactRecord } from "../facts.ts";
import type { EntitiesFile } from "../questions/index.ts";
import type { FactRequest, FactSubmission } from "../workflow/fact-requests.ts";
import type { RAdvice, RCitation, RClaim, RMention, RReview, RRun, SourceType, Verdict } from "./types.ts";

export type DemoStaff = { email: string; name: string; role: "admin" | "member"; active: boolean };

export type DemoWorld = {
  entities: EntitiesFile;
  staff: DemoStaff[];
  runs: (RRun & { clientIds: string[] })[];
  mentions: RMention[];
  claims: RClaim[];
  reviews: RReview[];
  citations: RCitation[];
  facts: FactRecord[];
  advice: RAdvice[];
  requests: FactRequest[];
  submissions: FactSubmission[];
  /** 顧客ID → 専用URLのトークン（デモ用に固定） */
  tokens: Record<string, string>;
  revokedTokens: string[];
};

const ENGINES: EngineName[] = ["openai", "gemini", "perplexity", "claude"];
const WEEKS = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"];
const COST: Record<EngineName, number> = { openai: 6.3, gemini: 7.3, perplexity: 2.0, claude: 13.2 };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoToken(clientId: string): string {
  return createHash("sha256").update(`geo-demo:${clientId}`).digest("base64url");
}

type Profile = {
  clientId: string;
  industry: string;
  target: string;
  trials: number;
  weeks: string[];
  discovery: string[];
  /** 対象の出現確率（エンジン別）と週ごとの上昇幅 */
  appear: Record<EngineName, number>;
  appearTrend: number;
  competitors: { id: string; p: number }[];
  claims: ClaimSpec[];
  domains: { domain: string; type: SourceType; weight: number }[];
};

type ClaimSpec = {
  questionId: string;
  factKey: string;
  correct: { statement: string; evidence: string };
  /** 週・エンジンごとに、誤り/古い主張を出す確率 */
  wrong: (week: number, engine: EngineName) => { p: number; verdict: Verdict; statement: string; normalized: string; evidence: string; domain?: string } | null;
};

const IDOL: Profile = {
  clientId: "demo-idol",
  industry: "idol",
  target: "idol-a",
  trials: 5,
  weeks: WEEKS,
  discovery: ["idol-disc-001", "idol-disc-002", "idol-disc-003", "idol-disc-004", "idol-disc-005"],
  appear: { openai: 0.3, gemini: 0.2, perplexity: 0.28, claude: 0.05 },
  appearTrend: 0.025,
  competitors: [{ id: "idol-b", p: 0.55 }, { id: "idol-c", p: 0.24 }, { id: "idol-d", p: 0.1 }],
  domains: [
    { domain: "official.sample-idol-a.example", type: "official", weight: 3 },
    { domain: "music-news.example.jp", type: "media", weight: 3 },
    { domain: "matome.example.com", type: "other", weight: 2 },
    { domain: "fanwiki.example.org", type: "wiki", weight: 2 },
    { domain: "sns.example.com", type: "sns", weight: 1 },
    { domain: "shop.example.jp", type: "ec", weight: 1 },
  ],
  claims: [
    {
      questionId: "idol-ent-001",
      factKey: "current_members",
      correct: { statement: "メンバーは4人（山田花子・佐藤美咲・鈴木愛・高橋結衣）", evidence: "現在のメンバーは山田花子、佐藤美咲、鈴木愛、高橋結衣の4人です。" },
      wrong: (_w, e) =>
        e === "gemini" || e === "claude"
          ? { p: e === "gemini" ? 0.6 : 0.45, verdict: "outdated", statement: "メンバーは5人（田中りんを含む）", normalized: "members-5", evidence: "山田花子、佐藤美咲、鈴木愛、高橋結衣、田中りんの5人組グループです。", domain: "matome.example.com" }
          : null,
    },
    {
      questionId: "idol-ent-003",
      factKey: "agency",
      correct: { statement: "所属はサンプルプロダクション", evidence: "所属事務所はサンプルプロダクションです。" },
      wrong: (w, e) =>
        e === "openai" && w === 5
          ? { p: 0.6, verdict: "incorrect", statement: "所属は「サンプルエンターテインメント」", normalized: "agency-other", evidence: "サンプルエンターテインメントに所属する4人組です。", domain: "fanwiki.example.org" }
          : null,
    },
    {
      questionId: "idol-rec-001",
      factKey: "latest_release",
      correct: { statement: "最新シングルは「サンプルシングル」", evidence: "最新シングルは10月15日発売の「サンプルシングル」です。" },
      wrong: (w, e) =>
        w >= 3 && e === "gemini"
          ? { p: [0, 0, 0, 0.55, 0.4, 0.3][w], verdict: "outdated", statement: "最新シングルは「前作シングル」", normalized: "release-prev", evidence: "最新シングルは6月に発売された「前作シングル」です。", domain: "music-news.example.jp" }
          : null,
    },
    {
      questionId: "idol-ent-004",
      factKey: "formed_on",
      correct: { statement: "結成は2023年1月", evidence: "2023年1月に結成されました。" },
      wrong: (w, e) =>
        e === "perplexity" && w <= 3
          ? { p: 0.5, verdict: "incorrect", statement: "結成は2022年", normalized: "formed-2022", evidence: "2022年に結成されたグループです。", domain: "matome.example.com" }
          : null,
    },
  ],
};

const GAME: Profile = {
  clientId: "demo-game",
  industry: "game",
  target: "game-a",
  trials: 3,
  weeks: WEEKS,
  discovery: ["game-disc-001", "game-disc-002", "game-disc-003", "game-disc-004"],
  appear: { openai: 0.45, gemini: 0.4, perplexity: 0.35, claude: 0.3 },
  appearTrend: -0.01,
  competitors: [{ id: "game-b", p: 0.6 }, { id: "game-c", p: 0.45 }, { id: "game-d", p: 0.2 }],
  domains: [
    { domain: "game.sample-quest.example", type: "official", weight: 2 },
    { domain: "game-media.example.jp", type: "media", weight: 3 },
    { domain: "kouryaku-wiki.example.org", type: "wiki", weight: 4 },
    { domain: "store.example.com", type: "ec", weight: 2 },
  ],
  claims: [
    {
      questionId: "game-ent-001",
      factKey: "publisher",
      correct: { statement: "運営はサンプルゲームス株式会社", evidence: "運営はサンプルゲームス株式会社です。" },
      wrong: () => null,
    },
    {
      questionId: "game-ent-002",
      factKey: "platforms",
      correct: { statement: "iOS・Android・PCで配信", evidence: "iOS、Android、PC（Steam）で遊べます。" },
      wrong: (_w, e) =>
        e === "claude" || e === "openai"
          ? { p: e === "claude" ? 0.5 : 0.25, verdict: "outdated", statement: "スマホ（iOS・Android）のみ", normalized: "platforms-mobile", evidence: "iOSとAndroidで配信中のスマホゲームです。", domain: "kouryaku-wiki.example.org" }
          : null,
    },
  ],
};

const MUSIC: Profile = {
  clientId: "demo-music",
  industry: "music",
  target: "music-a",
  trials: 3,
  weeks: ["2026-11-02"],
  discovery: ["music-disc-001", "music-disc-002", "music-disc-003", "music-disc-004"],
  appear: { openai: 0.25, gemini: 0.1, perplexity: 0.2, claude: 0 },
  appearTrend: 0,
  competitors: [{ id: "music-b", p: 0.5 }, { id: "music-c", p: 0.3 }, { id: "music-d", p: 0.2 }],
  domains: [
    { domain: "artist.sample-a.example", type: "official", weight: 1 },
    { domain: "music-news.example.jp", type: "media", weight: 3 },
    { domain: "lyrics.example.com", type: "other", weight: 2 },
    { domain: "sns.example.com", type: "sns", weight: 2 },
  ],
  claims: [
    {
      questionId: "music-ent-002",
      factKey: "label",
      correct: { statement: "所属レーベルはサンプルレコーズ", evidence: "サンプルレコーズに所属しています。" },
      wrong: (_w, e) =>
        e !== "perplexity"
          ? { p: 0.5, verdict: "outdated", statement: "所属レーベルは「旧インディーズレーベル」", normalized: "label-old", evidence: "インディーズレーベルの旧インディーズレーベルから作品を発表しています。", domain: "lyrics.example.com" }
          : null,
    },
    {
      questionId: "music-rec-001",
      factKey: "latest_release",
      correct: { statement: "最新リリースは「サンプルアルバム」", evidence: "最新作は10月に出たアルバム「サンプルアルバム」です。" },
      wrong: (_w, e) =>
        e === "gemini" ? { p: 0.67, verdict: "outdated", statement: "最新リリースは「デビューEP」", normalized: "release-ep", evidence: "最新作はデビューEPです。", domain: "music-news.example.jp" } : null,
    },
  ],
};

export function buildDemoWorld(): DemoWorld {
  const entities: EntitiesFile = {
    clients: [
      { id: "demo-idol", name: "サンプル芸能（デモ）", plan: "pro" },
      { id: "demo-game", name: "サンプルゲームス（デモ）", plan: "basic" },
      { id: "demo-music", name: "サンプルレコーズ（デモ）", plan: "lite" },
    ],
    entities: [
      ent("idol-a", "demo-idol", "idol", "target", "group", "サンプルアイドルA", ["idol-b", "idol-c", "idol-d"]),
      ent("idol-b", "demo-idol", "idol", "competitor", "group", "サンプルアイドルB"),
      ent("idol-c", "demo-idol", "idol", "competitor", "group", "サンプルアイドルC"),
      ent("idol-d", "demo-idol", "idol", "competitor", "group", "サンプルアイドルD"),
      ent("game-a", "demo-game", "game", "target", "title", "サンプルクエスト", ["game-b", "game-c", "game-d"]),
      ent("game-b", "demo-game", "game", "competitor", "title", "サンプルファンタジア"),
      ent("game-c", "demo-game", "game", "competitor", "title", "サンプルブレイブ"),
      ent("game-d", "demo-game", "game", "competitor", "title", "サンプルサーガ"),
      ent("music-a", "demo-music", "music", "target", "artist", "サンプルアーティストA", ["music-b", "music-c", "music-d"]),
      ent("music-b", "demo-music", "music", "competitor", "artist", "サンプルアーティストB"),
      ent("music-c", "demo-music", "music", "competitor", "artist", "サンプルアーティストC"),
      ent("music-d", "demo-music", "music", "competitor", "artist", "サンプルアーティストD"),
    ],
  };
  const world: DemoWorld = {
    entities,
    staff: [
      { email: "yamamoto@example.com", name: "山本", role: "admin", active: true },
      { email: "sato@example.com", name: "佐藤", role: "member", active: true },
    ],
    runs: [], mentions: [], claims: [], reviews: [], citations: [], facts: [], advice: [], requests: [], submissions: [],
    tokens: Object.fromEntries(entities.clients.map((c) => [c.id, demoToken(c.id)])),
    revokedTokens: [],
  };
  const r = rng(20261103);
  for (const p of [IDOL, GAME, MUSIC]) generate(world, p, r);
  // 条件付きの質問（既存の数字が変わらないよう、別の乱数で後から足す）
  generateContexts(world, IDOL, rng(20261231));
  addFacts(world);
  addWorkflow(world);
  return world;
}

function ent(id: string, client_id: string, industry: string, role: "target" | "competitor", type: "group" | "title" | "artist", official_name: string, competitors: string[] = []) {
  return { id, client_id, industry, role, type, official_name, aliases: [], ambiguous: false, competitors, contexts: {} };
}

function pickDomain(p: Profile, r: () => number) {
  const total = p.domains.reduce((s, d) => s + d.weight, 0);
  let x = r() * total;
  for (const d of p.domains) if ((x -= d.weight) < 0) return d;
  return p.domains[0];
}

function generate(world: DemoWorld, p: Profile, r: () => number) {
  let seq = world.runs.length;
  p.weeks.forEach((week, wi) => {
    const w = p.weeks.length === 1 ? 5 : wi;
    const measurementId = `${p.clientId}-${week}`;
    const base = Date.parse(`${week}T01:00:00Z`); // 月曜 10:00 JST
    const at = (k: number) => new Date(base + k * 7000).toISOString();
    const runOf = (questionId: string, category: RRun["category"], engine: EngineName, entityId: string | null) => {
      const id = `run-${++seq}`;
      const run = { id, measurementId, questionId, category, engine, executedAt: at(seq % 3000), status: "ok" as const, entityId, costJpy: COST[engine] * (0.8 + r() * 0.4), clientIds: [p.clientId], context: {} };
      world.runs.push(run);
      const nCit = 2 + Math.floor(r() * 3);
      const used = new Set<string>();
      for (let i = 0; i < nCit; i++) {
        const d = pickDomain(p, r);
        if (used.has(d.domain)) continue;
        used.add(d.domain);
        world.citations.push({ runId: id, url: `https://${d.domain}/page/${(seq * 7 + i) % 97}`, domain: d.domain, sourceType: d.type });
      }
      return run;
    };
    for (let t = 0; t < p.trials; t++) {
      for (const q of p.discovery) {
        for (const e of ENGINES) {
          const run = runOf(q, "discovery", e, null);
          const listed: string[] = [];
          if (r() < Math.max(0, p.appear[e] + p.appearTrend * w)) listed.push(p.target);
          for (const c of p.competitors) if (r() < c.p) listed.push(c.id);
          listed.sort(() => r() - 0.5).forEach((id, i) => world.mentions.push({ runId: run.id, entityId: id, rank: i + 1 }));
        }
      }
      for (const spec of p.claims) {
        for (const e of ENGINES) {
          const run = runOf(spec.questionId, spec.questionId.includes("-rec-") ? "recency" : "entity", e, p.target);
          world.mentions.push({ runId: run.id, entityId: p.target, rank: null });
          const wrong = spec.wrong(w, e);
          const isWrong = wrong && r() < wrong.p;
          const id = `claim-${world.claims.length + 1}`;
          world.claims.push({
            id, runId: run.id, entityId: p.target, factKey: spec.factKey,
            statement: isWrong ? wrong.statement : spec.correct.statement,
            normalized: isWrong ? wrong.normalized : "correct",
            verdict: isWrong ? wrong.verdict : "correct",
            confidence: Math.round((0.8 + r() * 0.19) * 100) / 100,
            evidence: isWrong ? wrong.evidence : spec.correct.evidence,
          });
          if (isWrong && wrong.domain) world.citations.push({ runId: run.id, url: `https://${wrong.domain}/old/${run.id}`, domain: wrong.domain, sourceType: p.domains.find((d) => d.domain === wrong.domain)!.type });
        }
      }
    }
  });
  // 「誤り」判定の社内確認: 結成年（Perplexity）は確認済み、事務所（ChatGPT・最新週）は最初の1件だけ確認済みで残りは確認待ち
  for (const c of world.claims.filter((c) => c.verdict === "incorrect" && c.entityId === p.target)) {
    const run = world.runs.find((x) => x.id === c.runId)!;
    const firstAgency = world.claims.find((x) => x.normalized === "agency-other");
    if (c.normalized === "formed-2022" || c.id === firstAgency?.id) {
      world.reviews.push({ claimId: c.id, decision: "incorrect", reviewer: "yamamoto@example.com", reviewerName: "山本", reviewedAt: new Date(Date.parse(run.executedAt) + 26 * 3600_000).toISOString(), note: null });
    }
  }
}

function fact(entityId: string, key: string, value: unknown, validFrom: string | null, validTo: string | null, sourceUrl: string | null, extra: Partial<FactRecord> = {}): FactRecord {
  return {
    entityId, key, value, validFrom, validTo, sourceUrl, sourceType: sourceUrl ? "public" : "client_provided", publicFrom: null,
    checkedAt: "2026-10-30", note: null, importBatch: "demo", createdAt: "2026-09-20T00:00:00.000Z", ...extra,
  };
}

function addFacts(world: DemoWorld) {
  world.facts.push(
    fact("idol-a", "current_members", ["山田花子", "佐藤美咲", "鈴木愛", "高橋結衣"], "2025-04-01", null, "https://official.sample-idol-a.example/profile"),
    fact("idol-a", "current_members", ["山田花子", "佐藤美咲", "鈴木愛", "高橋結衣", "田中りん"], "2023-01-15", "2025-03-31", "https://official.sample-idol-a.example/news/graduation"),
    fact("idol-a", "former_members", ["田中りん"], "2025-04-01", null, "https://official.sample-idol-a.example/news/graduation"),
    fact("idol-a", "agency", "サンプルプロダクション", "2023-01-15", null, "https://official.sample-idol-a.example/company"),
    fact("idol-a", "formed_on", "2023-01-15", null, null, "https://official.sample-idol-a.example/profile"),
    fact("idol-a", "latest_release", { title: "前作シングル", date: "2026-06-01" }, "2026-06-01", "2026-10-14", "https://official.sample-idol-a.example/discography"),
    fact("idol-a", "latest_release", { title: "サンプルシングル", date: "2026-10-15" }, "2026-10-15", null, "https://official.sample-idol-a.example/discography", { createdAt: "2026-10-15T03:00:00.000Z" }),
    fact("game-a", "publisher", "サンプルゲームス株式会社", null, null, "https://game.sample-quest.example/about"),
    fact("game-a", "platforms", ["iOS", "Android", "PC"], "2026-08-01", null, "https://game.sample-quest.example/news/pc"),
    fact("game-a", "platforms", ["iOS", "Android"], "2024-04-10", "2026-07-31", "https://game.sample-quest.example/about"),
    fact("game-a", "service_status", "active", null, null, "https://game.sample-quest.example/about"),
    fact("music-a", "label", "サンプルレコーズ", "2025-09-01", null, null, { note: "顧客の申告（社内承認済み）" }),
    fact("music-a", "latest_release", { title: "サンプルアルバム", date: "2026-10-08" }, "2026-10-08", null, "https://artist.sample-a.example/discography"),
  );
}

function addWorkflow(world: DemoWorld) {
  const mIdol = "demo-idol-2026-11-02";
  world.advice.push(
    {
      id: "advice-1", clientId: "demo-idol", measurementId: "demo-idol-2026-10-26", createdAt: "2026-10-27T02:00:00.000Z", status: "approved",
      approvedBy: "yamamoto@example.com", approvedAt: "2026-10-27T05:00:00.000Z",
      comment: "Gemini と Claude の「5人」は、まとめサイトの2024年の記事が主な原因です。公式のメンバーページの更新と並行して、記事の訂正依頼を先に出しましょう。",
      items: [
        { priority: "high", action: "公式サイトのメンバーページに、現在の4人と「2025年4月1日現在」の日付を明記する", reason: "Gemini と Claude が卒業済みのメンバーを含めて回答している", effort: "small", draft: "サンプルアイドルAは、山田花子・佐藤美咲・鈴木愛・高橋結衣の4人で活動しています（2025年4月1日現在）。田中りんは2025年3月31日をもって卒業しました。" },
        { priority: "high", action: "まとめサイトの2024年の記事に、メンバー情報の訂正を依頼する", reason: "誤った回答の主な引用元になっている", effort: "small", draft: "貴サイトの記事「サンプルアイドルAのメンバー紹介」について、メンバー情報が2024年時点のままとなっております。2025年3月31日に田中りんが卒業し、現在は4人で活動しております（公式発表: https://official.sample-idol-a.example/news/graduation）。お手数ですが、記事の更新をご検討いただけますと幸いです。" },
        { priority: "mid", action: "新曲「サンプルシングル」の告知をプレスリリースとして配信する", reason: "Gemini が前作を最新シングルとして回答している", effort: "mid" },
      ],
    },
    {
      id: "advice-2", clientId: "demo-idol", measurementId: mIdol, createdAt: "2026-11-03T02:00:00.000Z", status: "draft", approvedBy: null, approvedAt: null, comment: null,
      items: [
        { priority: "high", action: "ファンwiki の所属事務所の記載を確認し、誤りがあれば訂正を依頼する", reason: "ChatGPT が所属事務所を誤って回答（今週から）", effort: "small" },
        { priority: "mid", action: "公式サイトの会社概要に、所属事務所名を正式名称で明記する", reason: "所属事務所の一次情報が少ない", effort: "small" },
      ],
    },
    {
      id: "advice-3", clientId: "demo-music", measurementId: "demo-music-2026-11-02", createdAt: "2026-11-03T03:00:00.000Z", status: "approved",
      approvedBy: "sato@example.com", approvedAt: "2026-11-03T06:00:00.000Z", comment: null,
      items: [
        { priority: "high", action: "公式サイトのプロフィールに、現在の所属レーベルと移籍日を明記する", reason: "3つのAIが旧レーベルの情報で回答している", effort: "small", draft: "サンプルアーティストAは、2025年9月よりサンプルレコーズに所属しています。" },
        { priority: "high", action: "歌詞サイトのアーティスト情報の更新を依頼する", reason: "旧レーベルの情報の主な引用元", effort: "small" },
        { priority: "mid", action: "新アルバム「サンプルアルバム」の情報を、公式サイトのトップと SNS の固定投稿に載せる", reason: "Gemini がデビューEPを最新作として回答している", effort: "small" },
        { priority: "low", action: "おすすめ系の質問で挙がるよう、音楽メディアでのインタビュー掲載を増やす", reason: "4つのAIのおすすめで出現率が低い（Claude は0回）", effort: "large" },
      ],
    },
  );
  world.requests.push(
    { id: "req-1", clientId: "demo-idol", entityId: "idol-a", key: "upcoming_live", reason: "公開情報で次のライブ予定が見つかりません。予定があれば、公表してよい日とあわせて教えてください。", requestedBy: "yamamoto@example.com", requestedAt: "2026-11-02T03:00:00.000Z", status: "open", closedAt: null },
    { id: "req-2", clientId: "demo-game", entityId: "game-a", key: "current_events", reason: "開催中のイベント一覧を、正式名称で教えてください。", requestedBy: "sato@example.com", requestedAt: "2026-10-30T03:00:00.000Z", status: "submitted", closedAt: null },
  );
  world.submissions.push({
    id: "sub-1", requestId: "req-2", clientId: "demo-game", entityId: "game-a", key: "current_events",
    input: { value: "秋の収穫祭イベント|ハロウィン限定ガチャ", validFrom: "2026-10-28", sourceUrl: "https://game.sample-quest.example/news/autumn", sourceType: "public", checkedAt: "2026-11-01", note: "11/10 まで" },
    via: "client_form", submittedBy: "client:demo-game", submittedAt: "2026-11-01T09:00:00.000Z", status: "pending", reviewedBy: null, reviewedAt: null, reviewNote: null,
  });
}

/**
 * 条件付きのおすすめ質問（アイドルのみ）
 * - 毎週: 「{region}で今週末おすすめのアイドルライブは？」渋谷・新宿・大阪
 * - ハロウィン週だけ: 「{occasion}の{region}のアイドルイベントで注目は？」ハロウィン × 渋谷
 */
function generateContexts(world: DemoWorld, p: Profile, r: () => number) {
  let seq = world.runs.length;
  const regions: { region: string; me: number; trend: number; comp: Record<string, number> }[] = [
    { region: "渋谷", me: 0.48, trend: 0.02, comp: { "idol-b": 0.42, "idol-c": 0.3, "idol-d": 0.12 } },
    { region: "新宿", me: 0.3, trend: 0.01, comp: { "idol-b": 0.5, "idol-c": 0.22, "idol-d": 0.15 } },
    { region: "大阪", me: 0.05, trend: 0, comp: { "idol-b": 0.62, "idol-c": 0.12, "idol-d": 0.35 } },
  ];
  const emit = (week: string, questionId: string, context: Record<string, string>, me: number, comp: Record<string, number>, trend: number) => {
    const measurementId = `${p.clientId}-${week}`;
    const base = Date.parse(`${week}T03:00:00Z`);
    for (let t = 0; t < p.trials; t++) {
      for (const engine of ENGINES) {
        const id = `run-${++seq}`;
        world.runs.push({
          id, measurementId, questionId, category: "discovery", engine, executedAt: new Date(base + seq * 5000).toISOString(), status: "ok",
          entityId: null, costJpy: COST[engine] * (0.8 + r() * 0.4), clientIds: [p.clientId], context,
        });
        const listed: string[] = [];
        if (r() < Math.max(0, me + trend)) listed.push(p.target);
        for (const [cid, cp] of Object.entries(comp)) if (r() < cp) listed.push(cid);
        listed.sort(() => r() - 0.5).forEach((eid, i) => world.mentions.push({ runId: id, entityId: eid, rank: i + 1 }));
        const d = pickDomain(p, r);
        world.citations.push({ runId: id, url: `https://${d.domain}/event/${seq % 89}`, domain: d.domain, sourceType: d.type });
      }
    }
  };
  p.weeks.forEach((week, wi) => {
    for (const g of regions) emit(week, "idol-disc-006", { region: g.region }, g.me, g.comp, g.trend * wi);
    if (week === "2026-10-26") emit(week, "idol-disc-007", { occasion: "ハロウィン", region: "渋谷" }, 0.55, { "idol-b": 0.35, "idol-c": 0.4, "idol-d": 0.1 }, 0);
  });
}
