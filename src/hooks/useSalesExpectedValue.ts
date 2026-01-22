import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getDisplayQuantities } from "@/lib/salesLineQuantities";

export type SalesExpectedValueRow = {
  itemId: string;
  // A
  totalQtySinceOpening: number;
  // B
  totalWithdrawnQty: number;
  // avg purchase unit price since opening
  avgPurchaseUnitPrice: number;
  // F = (A - B) * avgPrice
  expectedValue: number;
};

function safeNum(n: any): number {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)));
}

/**
 * Computes expected value per item (ف) for a given invoice date:
 * ف = (أ - ب) * (متوسط سعر الشراء)
 * أ = (كمية الرصيد الافتتاحي + مشتريات حتى تاريخ الفاتورة)
 * ب = مجموع الكمية المسحوبة حتى تاريخ الفاتورة
 */
export function useSalesExpectedValue(params: {
  itemIds: Array<string | null | undefined>;
  invoiceDate: string | null | undefined;
}) {
  const invoiceDate = params.invoiceDate ?? "";
  const itemIds = useMemo(() => uniq((params.itemIds ?? []) as string[]), [params.itemIds]);

  return useQuery({
    enabled: Boolean(invoiceDate) && Boolean(itemIds?.length),
    queryKey: ["sales-expected-value", invoiceDate, itemIds.join("|")],
    queryFn: async (): Promise<Record<string, SalesExpectedValueRow>> => {
      const ids = uniq((itemIds ?? []) as string[]);
      if (!invoiceDate || ids.length === 0) return {};

      // 1) Opening stock quantities up to invoiceDate
      const { data: openingRows, error: openingErr } = await supabase
        .from("opening_stock")
        .select("item_id, quantity, entry_date")
        .in("item_id", ids)
        .lte("entry_date", invoiceDate);
      if (openingErr) throw openingErr;

      const openingQtyByItem = new Map<string, number>();
      for (const r of openingRows ?? []) {
        const itemId = (r as any).item_id as string;
        const qty = safeNum((r as any).quantity);
        openingQtyByItem.set(itemId, (openingQtyByItem.get(itemId) ?? 0) + qty);
      }

      // 2) Purchases quantities + prices up to invoiceDate
      const { data: purchaseRows, error: purchaseErr } = await supabase
        .from("purchase_lines")
        .select(
          `item_id, quantity_paid, quantity_free, unit_price, header:purchase_headers(invoice_date)`
        )
        .in("item_id", ids);
      if (purchaseErr) throw purchaseErr;

      const purchaseQtyByItem = new Map<string, number>();
      const purchasePriceSumByItem = new Map<string, number>();
      const purchasePriceCountByItem = new Map<string, number>();

      for (const r of purchaseRows ?? []) {
        const headerDate = (r as any)?.header?.invoice_date as string | undefined;
        if (!headerDate || headerDate > invoiceDate) continue;

        const itemId = (r as any).item_id as string;
        const qtyPaid = safeNum((r as any).quantity_paid);
        const qtyFree = safeNum((r as any).quantity_free);
        const qty = qtyPaid + qtyFree;
        const unitPrice = safeNum((r as any).unit_price);

        purchaseQtyByItem.set(itemId, (purchaseQtyByItem.get(itemId) ?? 0) + qty);
        // As requested: average = (sum of purchase prices) / (count of occurrences)
        // We'll treat each purchase line as one occurrence.
        if (unitPrice > 0) {
          purchasePriceSumByItem.set(itemId, (purchasePriceSumByItem.get(itemId) ?? 0) + unitPrice);
          purchasePriceCountByItem.set(itemId, (purchasePriceCountByItem.get(itemId) ?? 0) + 1);
        }
      }

      // 3) Withdrawn quantities up to invoiceDate (from sales_lines notes metadata)
      const { data: salesLineRows, error: salesLineErr } = await supabase
        .from("sales_lines")
        .select(`item_id, quantity, notes, header:sales_headers(invoice_date)`)
        .in("item_id", ids);
      if (salesLineErr) throw salesLineErr;

      const withdrawnByItem = new Map<string, number>();
      for (const r of salesLineRows ?? []) {
        const headerDate = (r as any)?.header?.invoice_date as string | undefined;
        if (!headerDate || headerDate > invoiceDate) continue;

        const itemId = (r as any).item_id as string;
        const q = getDisplayQuantities({ quantity: (r as any).quantity, notes: (r as any).notes ?? null });
        const withdrawn = safeNum(q.withdrawn);
        withdrawnByItem.set(itemId, (withdrawnByItem.get(itemId) ?? 0) + withdrawn);
      }

      const out: Record<string, SalesExpectedValueRow> = {};
      for (const itemId of ids) {
        const a = (openingQtyByItem.get(itemId) ?? 0) + (purchaseQtyByItem.get(itemId) ?? 0);
        const b = withdrawnByItem.get(itemId) ?? 0;
        const sumPrices = purchasePriceSumByItem.get(itemId) ?? 0;
        const cntPrices = purchasePriceCountByItem.get(itemId) ?? 0;
        const avgPrice = cntPrices > 0 ? sumPrices / cntPrices : 0;
        const expectedValue = (a - b) * avgPrice;

        out[itemId] = {
          itemId,
          totalQtySinceOpening: a,
          totalWithdrawnQty: b,
          avgPurchaseUnitPrice: avgPrice,
          expectedValue,
        };
      }

      return out;
    },
  });
}
