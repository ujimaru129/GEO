/**
 * 表記ゆれ吸収のための正規化（言及検出・別名辞書で共通利用）
 * - NFKC: 全角英数→半角、半角カナ→全角カナ など
 * - 英字は小文字に
 * - カタカナ→ひらがな（長音「ー」は残す）
 * - 空白・記号を除去（文字・数字・かな・漢字・長音だけ残す）
 */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[^\p{L}\p{N}ー]/gu, "");
}
