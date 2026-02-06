import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchOpeningBaselineDate } from "@/lib/openingBaseline";

function uniq(arr: Array<string | null | undefined>): string[] {
  return Array.from(new Set((arr ?? []).filter(Boolean) as string[]));
}

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export type SalesStockPricingRow = {
  itemId: string;
  /** الرصيد = افتتاحي + مشتريات - مبيعات - توالف (ضمن الفترة) */
  stockBalance: number;
  /** آخر سعر شراء للصنف ضمن الفترة */
  lastPurchaseUnitPrice: number;
  /** آخر هامش (margin_factor) ضمن الفترة */
  lastPurchaseMarginFactor: number;
  /** بيانات آخر فاتورة شراء للربط */
  lastPurchaseHeaderId: string | null;
  lastPurchaseInvoiceNo: string | null;
  lastPurchaseDate: string | null;
};

/**
 * يحسب:
 * - رصيد المخزن لكل صنف حتى تاريخ فاتورة البيع (ضمن الفترة من أول تاريخ رصيد افتتاحي للصنف).
 * - آخر سعر شراء + الهامش (margin_factor) من آخر فاتورة شراء ضمن نفس الفترة.
 *
 * ملاحظة: في صفحة تفاصيل البيع نستثني الفاتورة الحالية من حساب المبيعات حتى لا “تأكل” الرصيد.
 */
/**
 * يحسب رصيد المخزن وآخر سعر شراء - يعمل فقط عند وجود بيانات في الكاش
 * أو عند استدعاء refetch يدوياً (من زر التحديث الشامل).
 * 
 * @param manualTrigger - إذا كان false، لا يتم الحساب تلقائياً (يعتمد على الكاش فقط)
 */
export function useSalesStockPricing(params: {
  itemIds: Array<string | null | undefined>;
  invoiceDate: string | null | undefined;
  excludeSalesHeaderId?: string | null;
  /** إذا كان false (الافتراضي)، لا يتم الجلب تلقائياً - يعتمد على الكاش أو التحديث اليدوي */
  manualTrigger?: boolean;
}) {
  const invoiceDate = params.invoiceDate ?? "";
  const itemIds = useMemo(() => uniq(params.itemIds), [params.itemIds]);
  const excludeSalesHeaderId = params.excludeSalesHeaderId ?? null;
  const manualTrigger = params.manualTrigger ?? false;

  return useQuery({
    // لا يتم الجلب تلقائياً إلا إذا كان manualTrigger = true
    enabled: manualTrigger && Boolean(invoiceDate) && itemIds.length > 0,
    queryKey: ["sales-stock-pricing", invoiceDate, excludeSalesHeaderId ?? "", itemIds.join("|")],
    queryFn: async (): Promise<Record<string, SalesStockPricingRow>> => {
      const ids = uniq(itemIds);
      if (!invoiceDate || ids.length === 0) return {};

      // 1) Opening stock is a fixed baseline (start of work): earliest entry_date in opening_stock.
      const baselineDate = (await fetchOpeningBaselineDate()) ?? "0001-01-01";

      const { data: openingRows, error: openingErr } = await supabase
        .from("opening_stock")
        .select("item_id, quantity")
        .in("item_id", ids)
        .eq("entry_date", baselineDate);
      if (openingErr) throw openingErr;

      const openingQtyByItem = new Map<string, number>();
      for (const r of openingRows ?? []) {
        const itemId = (r as any).item_id as string;
        const qty = toNum((r as any).quantity);
        openingQtyByItem.set(itemId, (openingQtyByItem.get(itemId) ?? 0) + qty);
      }

      // 2) Purchases within period (start..invoiceDate)
      const { data: purchaseRows, error: purchaseErr } = await supabase
        .from("purchase_lines")
        .select(
          `item_id, quantity_paid, quantity_free, unit_price, margin_factor, header:purchase_headers(id, invoice_no, invoice_date, created_at)`
        )
        .in("item_id", ids);
      if (purchaseErr) throw purchaseErr;

      const purchasedQtyByItem = new Map<string, number>();
      const lastPurchaseByItem = new Map<
        string,
        {
          date: string;
          createdAt: string;
          unitPrice: number;
          margin: number;
          headerId: string | null;
          invoiceNo: string | null;
        }
      >();

      for (const r of purchaseRows ?? []) {
        const itemId = (r as any).item_id as string;
        const header = (r as any).header as any;
        const headerDate = String(header?.invoice_date ?? "");
        const headerCreatedAt = String(header?.created_at ?? "");
        if (!headerDate) continue;

        if (headerDate < baselineDate || headerDate > invoiceDate) continue;

        const paid = toNum((r as any).quantity_paid);
        const free = toNum((r as any).quantity_free);
        purchasedQtyByItem.set(itemId, (purchasedQtyByItem.get(itemId) ?? 0) + paid + free);

        const unitPrice = toNum((r as any).unit_price);
        const margin = toNum((r as any).margin_factor ?? 1);
        const headerId = (header?.id as string) ?? null;
        const invoiceNo = (header?.invoice_no as string) ?? null;

        const prev = lastPurchaseByItem.get(itemId);
        const isNewer =
          !prev ||
          headerDate > prev.date ||
          (headerDate === prev.date && headerCreatedAt && headerCreatedAt > (prev.createdAt || ""));

        if (isNewer) {
          lastPurchaseByItem.set(itemId, {
            date: headerDate,
            createdAt: headerCreatedAt,
            unitPrice,
            margin,
            headerId,
            invoiceNo,
          });
        }
      }

      // 3) Wastage within period
      const { data: wastageRows, error: wastageErr } = await supabase
        .from("wastage_lines")
        .select(`item_id, quantity, header:wastage_headers(wastage_date)`)
        .in("item_id", ids);
      if (wastageErr) throw wastageErr;

      const wastageQtyByItem = new Map<string, number>();
      for (const r of wastageRows ?? []) {
        const itemId = (r as any).item_id as string;
        const headerDate = String((r as any)?.header?.wastage_date ?? "");
        if (!headerDate) continue;
        if (headerDate < baselineDate || headerDate > invoiceDate) continue;
        wastageQtyByItem.set(itemId, (wastageQtyByItem.get(itemId) ?? 0) + toNum((r as any).quantity));
      }

      // 4) Sales within period (exclude current invoice if requested)
      const { data: salesRows, error: salesErr } = await supabase
        .from("sales_lines")
        .select(`item_id, quantity, sales_header_id, header:sales_headers(invoice_date)`)
        .in("item_id", ids);
      if (salesErr) throw salesErr;

      const soldQtyByItem = new Map<string, number>();
      for (const r of salesRows ?? []) {
        const itemId = (r as any).item_id as string;
        const headerDate = String((r as any)?.header?.invoice_date ?? "");
        if (!headerDate) continue;
        if (excludeSalesHeaderId && String((r as any).sales_header_id ?? "") === excludeSalesHeaderId) continue;

        if (headerDate < baselineDate || headerDate > invoiceDate) continue;

        soldQtyByItem.set(itemId, (soldQtyByItem.get(itemId) ?? 0) + toNum((r as any).quantity));
      }

      const out: Record<string, SalesStockPricingRow> = {};
      for (const itemId of ids) {
        const opening = openingQtyByItem.get(itemId) ?? 0;
        const purchased = purchasedQtyByItem.get(itemId) ?? 0;
        const wastage = wastageQtyByItem.get(itemId) ?? 0;
        const sold = soldQtyByItem.get(itemId) ?? 0;
        const stockBalance = opening + purchased - sold - wastage;

        const last = lastPurchaseByItem.get(itemId);
        out[itemId] = {
          itemId,
          stockBalance,
          lastPurchaseUnitPrice: last?.unitPrice ?? 0,
          lastPurchaseMarginFactor: last?.margin ?? 1,
          lastPurchaseHeaderId: last?.headerId ?? null,
          lastPurchaseInvoiceNo: last?.invoiceNo ?? null,
          lastPurchaseDate: last?.date ?? null,
        };
      }
      return out;
    },
  });
}
