import type { AnalysisConfig } from "../config.ts";
import type { Citation } from "../engines/types.ts";
import type { Entity } from "../questions/index.ts";
import type { SourceType } from "../report/types.ts";

export type ClassifiedCitation = { url: string; domain: string; sourceType: SourceType };

/** Gemini の引用は Google のリダイレクトURL。元サイトのドメインは title に入る */
const REDIRECT_HOSTS = ["vertexaisearch.cloud.google.com"];

const stripWww = (h: string) => h.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

export function citationDomain(c: Citation): string | null {
  let host: string;
  try {
    host = new URL(c.url).hostname;
  } catch {
    return null;
  }
  if (REDIRECT_HOSTS.includes(host)) {
    const t = (c.title ?? "").trim().toLowerCase();
    // title がドメイン形式（例: natalie.mu）のときだけ採用する
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(t) ? stripWww(t) : null;
  }
  return stripWww(host);
}

const matches = (domain: string, list: string[]) => list.some((d) => domain === d || domain.endsWith(`.${d}`));

/** 引用元の種類。公式サイトの判定を最優先にする（公式の YouTube チャンネル等はドメインでは区別できないので sns 扱い） */
export function classifySource(domain: string, officialDomains: string[], lists: AnalysisConfig["source_domains"]): SourceType {
  if (matches(domain, officialDomains)) return "official";
  if (matches(domain, lists.wiki)) return "wiki";
  if (matches(domain, lists.sns)) return "sns";
  if (matches(domain, lists.ec)) return "ec";
  if (matches(domain, lists.media)) return "media";
  return "other";
}

export function officialDomainsOf(entities: Entity[]): string[] {
  return [...new Set(entities.flatMap((e) => (e.official_domains ?? []).map((d) => stripWww(d))))];
}

export function classifyCitations(citations: Citation[], officialDomains: string[], lists: AnalysisConfig["source_domains"]): ClassifiedCitation[] {
  const seen = new Set<string>();
  const out: ClassifiedCitation[] = [];
  for (const c of citations) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    const domain = citationDomain(c);
    if (!domain) continue;
    out.push({ url: c.url, domain, sourceType: classifySource(domain, officialDomains, lists) });
  }
  return out;
}
