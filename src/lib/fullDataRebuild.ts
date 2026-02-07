/**
 * خدمة إعادة بناء البيانات الشاملة
 * تُنفذ كل الحسابات وتحفظها في جدول computed_snapshots
 * 
 * قواعد صارمة:
 * - لا يتم تنفيذ أي حساب تلقائياً في أي مكان آخر
 * - هذه الدالة هي المكان الوحيد لتنفيذ الحسابات
 * - التقارير والصفحات تقرأ فقط من الجداول المحسوبة
 */

import { supabase } from "@/integrations/supabase/client";

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface RebuildProgress {
  step: string;
  current: number;
  total: number;
}

export interface RebuildResult {
  success: boolean;
  itemsProcessed: number;
  rebuildVersion: number;
  timestamp: string;
  error?: string;
}

/**
 * تنفيذ إعادة بناء البيانات الشاملة
 * يحسب رصيد المخزن وآخر سعر شراء لكل صنف ويحفظها
 */
export async function fullDataRebuild(
  onProgress?: (progress: RebuildProgress) => void
): Promise<RebuildResult> {
  const timestamp = new Date().toISOString();
  
  try {
    // الخطوة 1: جلب تاريخ الرصيد الافتتاحي (Baseline)
    onProgress?.({ step: "جلب تاريخ الرصيد الافتتاحي", current: 1, total: 8 });
    
    const { data: openingStockDates, error: baselineError } = await supabase
      .from("opening_stock")
      .select("entry_date")
      .order("entry_date", { ascending: true })
      .limit(1);
    
    if (baselineError) throw baselineError;
    
    const baselineDate = openingStockDates?.[0]?.entry_date ?? "0001-01-01";
    const today = new Date().toISOString().slice(0, 10);

    // الخطوة 2: جلب كل الأصناف النشطة
    onProgress?.({ step: "جلب قائمة الأصناف", current: 2, total: 8 });
    
    const { data: items, error: itemsError } = await supabase
      .from("items_master")
      .select("id")
      .eq("is_active", true);
    
    if (itemsError) throw itemsError;
    
    const itemIds = (items ?? []).map((i) => i.id);

    // الخطوة 3: جلب الرصيد الافتتاحي
    onProgress?.({ step: "جلب الرصيد الافتتاحي", current: 3, total: 8 });
    
    const { data: opening, error: openingError } = await supabase
      .from("opening_stock")
      .select("item_id,quantity")
      .eq("entry_date", baselineDate);
    
    if (openingError) throw openingError;
    
    const openingByItem = new Map<string, number>();
    for (const r of opening ?? []) {
      openingByItem.set(r.item_id, (openingByItem.get(r.item_id) ?? 0) + toNum(r.quantity));
    }

    // الخطوة 4: جلب المشتريات
    onProgress?.({ step: "جلب المشتريات", current: 4, total: 8 });
    
    const { data: purchases, error: purchasesError } = await supabase
      .from("purchase_lines")
      .select("item_id,quantity_paid,quantity_free,purchase_header_id,unit_price,margin_factor,purchase_headers!inner(invoice_date,id)")
      .gte("purchase_headers.invoice_date", baselineDate)
      .lte("purchase_headers.invoice_date", today);
    
    if (purchasesError) throw purchasesError;
    
    const purchasedByItem = new Map<string, number>();
    const lastPurchaseByItem = new Map<string, {
      price: number;
      marginFactor: number;
      date: string;
      invoiceId: string;
    }>();
    
    // ترتيب المشتريات حسب التاريخ للحصول على آخر سعر
    const sortedPurchases = [...(purchases ?? [])].sort((a, b) => {
      const dateA = (a.purchase_headers as any)?.invoice_date ?? "";
      const dateB = (b.purchase_headers as any)?.invoice_date ?? "";
      return dateA.localeCompare(dateB);
    });
    
    for (const r of sortedPurchases) {
      const paid = toNum(r.quantity_paid);
      const free = toNum(r.quantity_free);
      purchasedByItem.set(r.item_id, (purchasedByItem.get(r.item_id) ?? 0) + paid + free);
      
      // تحديث آخر سعر شراء (الأحدث يكتب فوق الأقدم)
      const header = r.purchase_headers as any;
      if (header?.invoice_date) {
        lastPurchaseByItem.set(r.item_id, {
          price: toNum(r.unit_price),
          marginFactor: toNum(r.margin_factor) || 1,
          date: header.invoice_date,
          invoiceId: r.purchase_header_id,
        });
      }
    }

    // الخطوة 5: جلب المبيعات
    onProgress?.({ step: "جلب المبيعات", current: 5, total: 8 });
    
    const { data: sales, error: salesError } = await supabase
      .from("sales_lines")
      .select("item_id,quantity,sales_headers!inner(invoice_date)")
      .gte("sales_headers.invoice_date", baselineDate)
      .lte("sales_headers.invoice_date", today);
    
    if (salesError) throw salesError;
    
    const soldByItem = new Map<string, number>();
    for (const r of sales ?? []) {
      soldByItem.set(r.item_id, (soldByItem.get(r.item_id) ?? 0) + toNum(r.quantity));
    }

    // الخطوة 6: جلب التوالف
    onProgress?.({ step: "جلب التوالف", current: 6, total: 8 });
    
    const { data: wastages, error: wastagesError } = await supabase
      .from("wastage_lines")
      .select("item_id,quantity,wastage_headers!inner(wastage_date)")
      .gte("wastage_headers.wastage_date", baselineDate)
      .lte("wastage_headers.wastage_date", today);
    
    if (wastagesError) throw wastagesError;
    
    const wastageByItem = new Map<string, number>();
    for (const r of wastages ?? []) {
      wastageByItem.set(r.item_id, (wastageByItem.get(r.item_id) ?? 0) + toNum(r.quantity));
    }

    // الخطوة 7: جلب رقم الإصدار الحالي
    onProgress?.({ step: "تحديث جدول اللقطات", current: 7, total: 8 });
    
    const { data: metadata, error: metaError } = await supabase
      .from("rebuild_metadata")
      .select("rebuild_version")
      .eq("singleton_id", true)
      .single();
    
    if (metaError && metaError.code !== "PGRST116") throw metaError;
    
    const newVersion = (metadata?.rebuild_version ?? 0) + 1;

    // الخطوة 8: حفظ اللقطات المحسوبة
    // حذف اللقطات القديمة أولاً
    const { error: deleteError } = await supabase
      .from("computed_snapshots")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000"); // حذف الكل
    
    if (deleteError) throw deleteError;

    // إنشاء اللقطات الجديدة
    const snapshots = itemIds.map((itemId) => {
      const opening_qty = openingByItem.get(itemId) ?? 0;
      const purchased_qty = purchasedByItem.get(itemId) ?? 0;
      const sold_qty = soldByItem.get(itemId) ?? 0;
      const wastage_qty = wastageByItem.get(itemId) ?? 0;
      const stock_balance = opening_qty + purchased_qty - sold_qty - wastage_qty;
      
      const lastPurchase = lastPurchaseByItem.get(itemId);
      
      return {
        item_id: itemId,
        opening_qty,
        purchased_qty,
        sold_qty,
        wastage_qty,
        stock_balance,
        last_purchase_price: lastPurchase?.price ?? null,
        last_purchase_margin_factor: lastPurchase?.marginFactor ?? null,
        last_purchase_date: lastPurchase?.date ?? null,
        last_purchase_invoice_id: lastPurchase?.invoiceId ?? null,
        snapshot_date: today,
        last_rebuild_at: timestamp,
        rebuild_version: newVersion,
      };
    });

    // إدخال اللقطات على دفعات
    const batchSize = 100;
    for (let i = 0; i < snapshots.length; i += batchSize) {
      const batch = snapshots.slice(i, i + batchSize);
      const { error: insertError } = await supabase
        .from("computed_snapshots")
        .insert(batch);
      
      if (insertError) throw insertError;
    }

    // تحديث البيانات الوصفية
    onProgress?.({ step: "تحديث البيانات الوصفية", current: 8, total: 8 });
    
    const { error: updateMetaError } = await supabase
      .from("rebuild_metadata")
      .update({
        last_rebuild_at: timestamp,
        rebuild_version: newVersion,
        items_processed: itemIds.length,
        updated_at: timestamp,
      })
      .eq("singleton_id", true);
    
    if (updateMetaError) throw updateMetaError;

    return {
      success: true,
      itemsProcessed: itemIds.length,
      rebuildVersion: newVersion,
      timestamp,
    };
  } catch (error: any) {
    console.error("Full data rebuild error:", error);
    return {
      success: false,
      itemsProcessed: 0,
      rebuildVersion: 0,
      timestamp,
      error: error?.message || "حدث خطأ غير متوقع",
    };
  }
}

/**
 * التحقق من حالة آخر إعادة بناء
 */
export async function getRebuildStatus(): Promise<{
  hasRebuild: boolean;
  lastRebuildAt: string | null;
  rebuildVersion: number;
  itemsProcessed: number;
} | null> {
  try {
    const { data, error } = await supabase
      .from("rebuild_metadata")
      .select("last_rebuild_at,rebuild_version,items_processed")
      .eq("singleton_id", true)
      .single();
    
    if (error) return null;
    
    return {
      hasRebuild: data?.last_rebuild_at !== null,
      lastRebuildAt: data?.last_rebuild_at ?? null,
      rebuildVersion: data?.rebuild_version ?? 0,
      itemsProcessed: data?.items_processed ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * جلب اللقطة المحسوبة لصنف معين
 */
export async function getComputedSnapshot(itemId: string) {
  const { data, error } = await supabase
    .from("computed_snapshots")
    .select("*")
    .eq("item_id", itemId)
    .single();
  
  if (error) return null;
  return data;
}

/**
 * جلب كل اللقطات المحسوبة
 */
export async function getAllComputedSnapshots() {
  const { data, error } = await supabase
    .from("computed_snapshots")
    .select("*");
  
  if (error) throw error;
  return data ?? [];
}
