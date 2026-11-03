import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { ClaudeEngine, parseClaudeResponse } from "../src/engines/claude.ts";
import { parseGeminiResponse } from "../src/engines/gemini.ts";
import { OpenAIEngine, parseOpenAIResponse } from "../src/engines/openai.ts";
import { PerplexityEngine, parsePerplexityResponse } from "../src/engines/perplexity.ts";
import { computeCost } from "../src/pricing.ts";

const config = loadConfig();

test("OpenAI: 本文・引用・検索回数・flex を取り出す", () => {
  const r = parseOpenAIResponse({
    model: "gpt-6.1-sol-2026-10-01",
    service_tier: "flex",
    output: [
      { type: "web_search_call", action: { type: "search", queries: ["a"] } },
      { type: "web_search_call", action: { type: "open_page" } },
      { type: "web_search_call", action: { type: "search", queries: ["b"] } },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "回答",
            annotations: [
              { type: "url_citation", url: "https://a.example", title: "A" },
              { type: "url_citation", url: "https://a.example", title: "A" },
            ],
          },
        ],
      },
    ],
    usage: { input_tokens: 1000, output_tokens: 300, output_tokens_details: { reasoning_tokens: 100 } },
  });
  assert.equal(r.text, "回答");
  assert.equal(r.model, "gpt-6.1-sol-2026-10-01");
  assert.deepEqual(r.citations, [{ url: "https://a.example", title: "A" }]);
  assert.equal(r.usage.searchCount, 2); // open_page は課金対象外
  assert.equal(r.usage.discountedTier, true);
});

test("OpenAI: flex 設定でも最終試行は standard にフォールバックする", () => {
  const e = new OpenAIEngine(config.engines.openai, "test-key");
  assert.equal(e.buildRequest("q").service_tier, "flex");
  assert.equal(e.buildRequest("q", { preferReliability: true }).service_tier, "default");
  assert.equal(e.buildRequest("q").tools[0].user_location?.country, "JP");
});

test("Gemini: 検索クエリ数で課金し、検索由来の入力トークンは数えない", () => {
  const r = parseGeminiResponse(
    {
      modelVersion: "gemini-3.8-flash-001",
      candidates: [
        {
          content: { parts: [{ text: "思考", thought: true }, { text: "回答1" }, { text: "回答2" }] },
          groundingMetadata: {
            webSearchQueries: ["q1", "q2", "q3"],
            groundingChunks: [{ web: { uri: "https://vertexaisearch.example/r1", title: "official.jp" } }],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 400, thoughtsTokenCount: 600, toolUsePromptTokenCount: 9000 },
    },
    "gemini-3.8-flash",
  );
  assert.equal(r.text, "回答1回答2");
  assert.equal(r.usage.searchCount, 3);
  assert.equal(r.usage.inputTokens, 20);
  assert.equal(r.usage.outputTokens, 1000);
  assert.equal(r.citations[0].title, "official.jp");
});

test("Perplexity: [n] 引用を search_results に対応付け、API の実費を使う", () => {
  const r = parsePerplexityResponse({
    model: "perplexity/sonar",
    output: [
      { type: "search_results", queries: ["x"], results: [
        { id: 1, url: "https://one.example", title: "1" },
        { id: 2, url: "https://two.example", title: "2" },
      ] },
      { type: "message", content: [{ type: "output_text", text: "答え[2]です" }] },
    ],
    usage: { input_tokens: 5000, output_tokens: 200, cost: { total_cost: 0.0018 } },
  });
  assert.deepEqual(r.citations, [{ url: "https://two.example", title: "2" }]);
  assert.equal(r.usage.searchCount, 1);
  const cost = computeCost(config.engines.perplexity.pricing, r.usage);
  assert.equal(cost.tokenUsd, 0.0018);
  assert.equal(cost.searchUsd, 0.0025);
});

test("Perplexity: リクエストに日本の位置情報を付ける", () => {
  const e = new PerplexityEngine(config.engines.perplexity, "test-key");
  const req = e.buildRequest("q");
  assert.equal(req.model, "perplexity/sonar");
  assert.equal(req.tools[0].user_location?.country, "JP");
});

test("Claude: web_search_result_location の引用と検索回数を取り出す", () => {
  const r = parseClaudeResponse({
    model: "claude-sonnet-5-5-20261001",
    content: [
      { type: "server_tool_use", name: "web_search", input: { query: "x" } },
      { type: "web_search_tool_result", content: [] },
      { type: "text", text: "前半", citations: [{ type: "web_search_result_location", url: "https://c.example", title: "C" }] },
      { type: "text", text: "後半" },
    ],
    usage: { input_tokens: 12000, output_tokens: 800, server_tool_use: { web_search_requests: 2 } },
  });
  assert.equal(r.text, "前半後半");
  assert.equal(r.usage.searchCount, 2);
  const cost = computeCost(config.engines.claude.pricing, r.usage);
  assert.ok(Math.abs(cost.totalUsd - (0.024 + 0.008 + 0.02)) < 1e-9);
});

test("Claude: システムプロンプトなし・検索ツールに日本の位置情報", () => {
  const req = new ClaudeEngine(config.engines.claude, "test-key").buildRequest("q") as any;
  assert.equal(req.system, undefined);
  assert.equal(req.tools[0].name, "web_search");
  assert.equal(req.tools[0].user_location.country, "JP");
});

test("flex の割引はトークン代にだけかかり、検索料金にはかからない", () => {
  const c = computeCost(config.engines.openai.pricing, { inputTokens: 1_000_000, outputTokens: 0, searchCount: 1000, discountedTier: true });
  assert.equal(c.tokenUsd, 1);
  assert.equal(c.searchUsd, 10);
});
