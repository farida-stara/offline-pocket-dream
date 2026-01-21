export function normalizeArabic(input: string): string {
  return (input ?? "")
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\u064B-\u0652]/g, "") // حذف التشكيل
    .replace(/ـ/g, "") // تطويل
    .replace(/[إأآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1, // حذف
        dp[j - 1] + 1, // إضافة
        prev + cost // استبدال
      );
      prev = temp;
    }
  }

  return dp[n];
}

function tokenScore(a: string, b: string): number {
  const at = a.split(" ").filter(Boolean);
  const bt = b.split(" ").filter(Boolean);
  if (!at.length || !bt.length) return 0;

  const bSet = new Set(bt);
  const common = at.filter((t) => bSet.has(t)).length;
  return common / Math.max(at.length, bt.length);
}

export function similarityScore(aRaw: string, bRaw: string): number {
  const a = normalizeArabic(aRaw);
  const b = normalizeArabic(bRaw);
  if (!a || !b) return 0;
  if (a === b) return 1;

  // احتواء مباشر يعطي دفعة
  const containsBoost = a.includes(b) || b.includes(a) ? 0.2 : 0;

  const lev = levenshtein(a, b);
  const levNorm = 1 - lev / Math.max(a.length, b.length);

  const tok = tokenScore(a, b);

  return Math.max(0, Math.min(1, 0.65 * levNorm + 0.35 * tok + containsBoost));
}

export function getBestItemMatches<T extends { id: string; item_name?: string | null; item_code?: string | null }>(
  query: string,
  items: T[] | undefined,
  limit = 5
): Array<{ id: string; label: string; score: number }> {
  if (!items?.length) return [];

  const scored = items
    .map((it) => {
      const name = it.item_name ?? "";
      const code = it.item_code ?? "";
      const s1 = similarityScore(query, name);
      const s2 = code ? similarityScore(query, code) : 0;
      const score = Math.max(s1, s2 * 0.9);
      return {
        id: it.id,
        label: code ? `${code} - ${name}` : name,
        score,
      };
    })
    .filter((x) => x.score > 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

type MatchKeys<T> = {
  name: keyof T;
  code?: keyof T;
};

export function getBestMatchesByKeys<T extends { id: string }>(
  query: string,
  rows: T[] | undefined,
  keys: MatchKeys<T>,
  limit = 5,
): Array<{ id: string; label: string; score: number }> {
  if (!rows?.length) return [];

  const getStr = (row: T, k: keyof T | undefined) => {
    if (!k) return "";
    const v = row[k];
    return v == null ? "" : String(v);
  };

  const scored = rows
    .map((row) => {
      const name = getStr(row, keys.name);
      const code = getStr(row, keys.code);
      const s1 = similarityScore(query, name);
      const s2 = code ? similarityScore(query, code) : 0;
      const score = Math.max(s1, s2 * 0.9);
      return {
        id: row.id,
        label: code ? `${code} - ${name}` : name,
        score,
      };
    })
    .filter((x) => x.score > 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

export function fuzzyMatch(query: string, target: string, threshold = 0.5): boolean {
  return similarityScore(query, target) >= threshold;
}
