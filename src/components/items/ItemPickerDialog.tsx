import { useMemo, useState } from "react";

import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { getBestItemMatches, normalizeArabic } from "@/lib/fuzzy";

export type ItemPickerRow = {
  id: string;
  item_code?: string | null;
  item_name?: string | null;
};

function itemLabel(it: ItemPickerRow) {
  const code = it.item_code ?? "";
  const name = it.item_name ?? "";
  return code ? `${code} - ${name}` : name;
}

function uniqueById<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

export function ItemPickerDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ItemPickerRow[] | undefined;
  onPick: (itemId: string) => void;
  suggestQuery?: string;
  placeholder?: string;
}) {
  const { open, onOpenChange, items, onPick, suggestQuery, placeholder } = props;
  const [query, setQuery] = useState("");

  const qNorm = useMemo(() => normalizeArabic(query), [query]);
  const suggestNorm = useMemo(() => normalizeArabic(suggestQuery ?? ""), [suggestQuery]);

  const suggestions = useMemo(() => {
    if (!items?.length) return [] as Array<{ id: string; label: string; score: number }>;
    if (!suggestQuery) return [];
    return getBestItemMatches(suggestQuery, items as any, 8).filter((x) => x.score >= 0.5);
  }, [items, suggestQuery]);

  const results = useMemo(() => {
    if (!items?.length) return [] as ItemPickerRow[];
    if (!qNorm) return items.slice(0, 200);

    const exact = items.filter((it) => it.item_code && normalizeArabic(it.item_code) === qNorm);
    const starts = items.filter((it) => {
      const code = it.item_code ? normalizeArabic(it.item_code) : "";
      const name = it.item_name ? normalizeArabic(it.item_name) : "";
      return (code && code.startsWith(qNorm)) || (name && name.startsWith(qNorm));
    });
    const fuzzy = getBestItemMatches(query, items as any, 60).map((m) => items.find((x) => x.id === m.id)!).filter(Boolean);
    return uniqueById([...exact, ...starts, ...fuzzy]).slice(0, 200);
  }, [items, qNorm, query]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
    >
      <CommandInput
        placeholder={placeholder ?? "ابحث بالكود أو الاسم…"}
        value={query}
        onValueChange={setQuery}
        autoFocus
      />
      <CommandList>
        <CommandEmpty>لا توجد نتائج</CommandEmpty>

        {!qNorm && !!suggestNorm && suggestions.length > 0 && (
          <CommandGroup heading="اقتراحات">
            {suggestions.map((s) => (
              <CommandItem
                key={s.id}
                value={s.label}
                onSelect={() => {
                  onPick(s.id);
                  onOpenChange(false);
                }}
              >
                {s.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading={qNorm ? `النتائج (${results.length})` : "الأصناف"}>
          {results.map((it) => (
            <CommandItem
              key={it.id}
              value={`${it.item_code ?? ""} ${it.item_name ?? ""}`}
              onSelect={() => {
                onPick(it.id);
                onOpenChange(false);
              }}
            >
              {itemLabel(it)}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
