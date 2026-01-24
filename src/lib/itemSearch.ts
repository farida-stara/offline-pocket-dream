import { normalizeArabic } from "@/lib/fuzzy";

/**
 * Normalize a search term for item codes/names:
 * - normalize Arabic characters/digits
 * - uppercase
 * - remove spaces and common separators
 */
export function normalizeItemSearchTerm(term: string): string {
  const base = normalizeArabic(term ?? "").trim();
  if (!base) return "";

  // remove spaces and common separators to handle non-fixed codes (e.g. A-001  / A001)
  const compact = base.replace(/[\s\-_.\/\\]+/g, "");
  return compact.toUpperCase();
}

/**
 * Build a small set of search tokens to increase match chance.
 * Keep it short to avoid overly long OR queries.
 */
export function buildItemSearchTokens(term: string): string[] {
  const raw = (term ?? "").trim();
  const n1 = normalizeArabic(raw).trim();
  const n2 = normalizeItemSearchTerm(raw);

  const out = [raw, n1, n2]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);

  // unique
  return Array.from(new Set(out)).slice(0, 3);
}
