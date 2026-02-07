import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

function uniq(arr: Array<string | null | undefined>): string[] {
  return Array.from(new Set((arr ?? []).filter(Boolean) as string[]));
}

export type SalesStockPricingRow = {
  itemId: string;
  /** الرصيد = افتتاحي + مشتريات - مبيعات - توالف (من جدول اللقطات) */
  stockBalance: number;
  /** آخر سعر شراء للصنف */
  lastPurchaseUnitPrice: number;
  /** آخر هامش (margin_factor) */
  lastPurchaseMarginFactor: number;
  /** بيانات آخر فاتورة شراء للربط */
  lastPurchaseHeaderId: string | null;
  lastPurchaseInvoiceNo: string | null;
  lastPurchaseDate: string | null;
};

/**
 * يقرأ بيانات المخزن والأسعار من جدول اللقطات المحسوبة (computed_snapshots)
 * 
 * **مهم**: هذا الـ hook لا ينفذ أي حسابات
 * بل يقرأ فقط من الجدول المحسوب مسبقاً بواسطة "إعادة بناء البيانات الشاملة"
 * 
 * @param itemIds - قائمة معرفات الأصناف
 * @param invoiceDate - تاريخ الفاتورة (غير مستخدم للحسابات - للتوافق فقط)
 * @param excludeSalesHeaderId - معرف فاتورة المبيعات للاستثناء (غير مستخدم - للتوافق فقط)
 * @param manualTrigger - تجاهل هذا المعامل (للتوافق مع الكود القديم)
 */
export function useSalesStockPricing(params: {
  itemIds: Array<string | null | undefined>;
  invoiceDate?: string | null | undefined;
  excludeSalesHeaderId?: string | null;
  manualTrigger?: boolean;
}) {
  const itemIds = useMemo(() => uniq(params.itemIds), [params.itemIds]);

  return useQuery({
    // يجلب دائماً من اللقطات المحسوبة - لا حسابات تلقائية
    enabled: itemIds.length > 0,
    staleTime: Infinity, // البيانات ثابتة حتى إعادة البناء
    queryKey: ["computed-snapshots", itemIds.join("|")],
    queryFn: async (): Promise<Record<string, SalesStockPricingRow>> => {
      if (itemIds.length === 0) return {};

      // قراءة من جدول اللقطات المحسوبة فقط - بدون أي حسابات
      const { data: snapshots, error } = await supabase
        .from("computed_snapshots")
        .select(`
          item_id,
          stock_balance,
          last_purchase_price,
          last_purchase_margin_factor,
          last_purchase_invoice_id,
          last_purchase_date
        `)
        .in("item_id", itemIds);

      if (error) throw error;

      // جلب أرقام الفواتير للربط
      const invoiceIds = (snapshots ?? [])
        .map((s) => s.last_purchase_invoice_id)
        .filter(Boolean) as string[];

      let invoiceNoMap = new Map<string, string>();
      if (invoiceIds.length > 0) {
        const { data: headers } = await supabase
          .from("purchase_headers")
          .select("id, invoice_no")
          .in("id", invoiceIds);
        
        for (const h of headers ?? []) {
          invoiceNoMap.set(h.id, h.invoice_no);
        }
      }

      const out: Record<string, SalesStockPricingRow> = {};
      
      for (const snapshot of snapshots ?? []) {
        const itemId = snapshot.item_id;
        out[itemId] = {
          itemId,
          stockBalance: Number(snapshot.stock_balance) || 0,
          lastPurchaseUnitPrice: Number(snapshot.last_purchase_price) || 0,
          lastPurchaseMarginFactor: Number(snapshot.last_purchase_margin_factor) || 1,
          lastPurchaseHeaderId: snapshot.last_purchase_invoice_id ?? null,
          lastPurchaseInvoiceNo: snapshot.last_purchase_invoice_id 
            ? invoiceNoMap.get(snapshot.last_purchase_invoice_id) ?? null 
            : null,
          lastPurchaseDate: snapshot.last_purchase_date ?? null,
        };
      }

      // للأصناف التي ليس لها لقطة (لم يتم إعادة البناء بعد)
      for (const itemId of itemIds) {
        if (!out[itemId]) {
          out[itemId] = {
            itemId,
            stockBalance: 0,
            lastPurchaseUnitPrice: 0,
            lastPurchaseMarginFactor: 1,
            lastPurchaseHeaderId: null,
            lastPurchaseInvoiceNo: null,
            lastPurchaseDate: null,
          };
        }
      }

      return out;
    },
  });
}
