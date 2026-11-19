import { normalizeName } from "../normalize.ts";
import type { Entity } from "../questions/index.ts";

export type DetectedMention = { entityId: string; rank: number };

type Span = { entityId: string; start: number; end: number };

/** 短すぎる別名は誤検出が多いので使わない（正規化後の文字数） */
const MIN_ALIAS_LENGTH = 2;
/** 一般名詞と同じ名前の対象は、質問の主題でない限り長い別名でしか拾わない */
const MIN_AMBIGUOUS_ALIAS_LENGTH = 4;

/**
 * 回答文に出てくる計測対象・競合をルールで検出する（費用なし）。
 * - 表記ゆれは normalizeName（全角半角・カタカナ/ひらがな・記号）で吸収する
 * - 別の対象の長い名前の一部として出てきただけのもの（例: 「サンプル」が「サンプルズ」の一部）は数えない
 * - rank は回答の中で最初に出てきた順（1始まり）。おすすめの列挙で何番目に挙がったかの目安
 * @param focusEntityId 質問の主題（「〇〇について教えて」の〇〇）。曖昧な名前でも短い別名で検出する
 */
export function detectMentions(text: string, candidates: Entity[], focusEntityId: string | null = null): DetectedMention[] {
  const body = normalizeName(text);
  if (!body) return [];
  const spans: Span[] = [];
  for (const e of candidates) {
    const min = e.ambiguous && e.id !== focusEntityId ? MIN_AMBIGUOUS_ALIAS_LENGTH : MIN_ALIAS_LENGTH;
    const aliases = [...new Set([e.official_name, ...e.aliases].map(normalizeName))].filter((a) => a.length >= min);
    for (const a of aliases) {
      for (let i = body.indexOf(a); i !== -1; i = body.indexOf(a, i + 1)) spans.push({ entityId: e.id, start: i, end: i + a.length });
    }
  }
  // 別の対象のより長い一致に完全に含まれるものは除く
  const kept = spans.filter(
    (s) => !spans.some((o) => o.entityId !== s.entityId && o.start <= s.start && s.end <= o.end && o.end - o.start > s.end - s.start),
  );
  const first = new Map<string, number>();
  for (const s of kept) first.set(s.entityId, Math.min(first.get(s.entityId) ?? Number.POSITIVE_INFINITY, s.start));
  return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([entityId], i) => ({ entityId, rank: i + 1 }));
}
