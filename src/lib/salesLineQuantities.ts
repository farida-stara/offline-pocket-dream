export type SalesLineQuantities = {
  sold: number;
  returned: number;
  withdrawn: number;
};

const PREFIX = "__qty__:";

function safeNum(n: any): number {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v : 0;
}

export function encodeLineQuantities(q: SalesLineQuantities): string {
  return `${PREFIX}${JSON.stringify({
    sold: safeNum(q.sold),
    returned: safeNum(q.returned),
    withdrawn: safeNum(q.withdrawn),
  })}`;
}

export function parseLineQuantities(notes?: string | null): SalesLineQuantities | null {
  const s = String(notes ?? "");
  const idx = s.indexOf(PREFIX);
  if (idx === -1) return null;
  const payload = s.slice(idx + PREFIX.length).split("\n")[0]?.trim();
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    return {
      sold: safeNum((parsed as any)?.sold),
      returned: safeNum((parsed as any)?.returned),
      withdrawn: safeNum((parsed as any)?.withdrawn),
    };
  } catch {
    return null;
  }
}

export function mergeNotesWithQuantities(
  baseNotes: string | undefined | null,
  q: SalesLineQuantities | null
): string | undefined {
  const base = String(baseNotes ?? "").trim();
  if (!q) return base || undefined;

  const hasAny = safeNum(q.sold) !== 0 || safeNum(q.returned) !== 0 || safeNum(q.withdrawn) !== 0;
  if (!hasAny) return base || undefined;

  const encoded = encodeLineQuantities(q);

  if (base.includes(PREFIX)) {
    const lines = base.split("\n").filter((l) => !l.startsWith(PREFIX));
    return [...lines, encoded].filter(Boolean).join("\n");
  }

  return base ? `${base}\n${encoded}` : encoded;
}

export function getDisplayQuantities(line: { quantity?: any; notes?: string | null }): SalesLineQuantities {
  const parsed = parseLineQuantities(line.notes);
  if (parsed) return parsed;
  return { sold: safeNum(line.quantity), returned: 0, withdrawn: 0 };
}
