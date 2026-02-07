import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Printer, AlertTriangle } from "lucide-react";
import { normalizeArabic } from "@/lib/fuzzy";
import { normalizeItemSearchTerm } from "@/lib/itemSearch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getRebuildStatus } from "@/lib/fullDataRebuild";

type Row = {
  item_id: string;
  item_code: string;
  item_name: string;
  category: string;
  opening_qty: number;
  purchased_qty: number;
  sold_qty: number;
  damaged_qty: number;
  current_qty: number;
  last_rebuild_at: string | null;
};

/**
 * تقرير المخزون - يقرأ من جدول اللقطات المحسوبة فقط
 * 
 * **مهم**: هذا التقرير لا ينفذ أي حسابات
 * بل يعرض فقط البيانات المحسوبة مسبقاً بواسطة "إعادة بناء البيانات الشاملة"
 */
export default function InventoryReport() {
  const [category, setCategory] = useState<string>("all");
  const [q, setQ] = useState<string>("");
  const [showZeroStock, setShowZeroStock] = useState(false);
  const qRef = useRef<HTMLInputElement | null>(null);

  // جلب حالة آخر إعادة بناء
  const { data: rebuildStatus } = useQuery({
    queryKey: ["rebuild-status"],
    queryFn: getRebuildStatus,
    staleTime: Infinity,
  });

  // قراءة من جدول اللقطات المحسوبة - بدون أي حسابات
  const { data, isFetching, error } = useQuery({
    queryKey: ["inventory-report", "computed-snapshots"],
    staleTime: Infinity,
    refetchOnMount: false,
    queryFn: async () => {
      // جلب الأصناف مع لقطاتها المحسوبة
      const { data: items, error: itemsError } = await supabase
        .from("items_master")
        .select("id,item_code,item_name,category,is_active")
        .eq("is_active", true)
        .order("item_code", { ascending: true });

      if (itemsError) throw itemsError;

      // جلب اللقطات المحسوبة
      const { data: snapshots, error: snapshotsError } = await supabase
        .from("computed_snapshots")
        .select("*");

      if (snapshotsError) throw snapshotsError;

      // بناء خريطة اللقطات
      const snapshotMap = new Map<string, any>();
      for (const s of snapshots ?? []) {
        snapshotMap.set(s.item_id, s);
      }

      const rows: Row[] = (items ?? []).map((it) => {
        const snapshot = snapshotMap.get(it.id);
        return {
          item_id: it.id,
          item_code: it.item_code,
          item_name: it.item_name,
          category: it.category,
          opening_qty: Number(snapshot?.opening_qty) || 0,
          purchased_qty: Number(snapshot?.purchased_qty) || 0,
          sold_qty: Number(snapshot?.sold_qty) || 0,
          damaged_qty: Number(snapshot?.wastage_qty) || 0,
          current_qty: Number(snapshot?.stock_balance) || 0,
          last_rebuild_at: snapshot?.last_rebuild_at ?? null,
        };
      });

      return { rows };
    },
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of data?.rows ?? []) set.add(r.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data?.rows]);

  const filtered = useMemo(() => {
    const raw = q.trim();
    const query = normalizeArabic(raw).toLowerCase();
    const queryCompact = normalizeItemSearchTerm(raw).toLowerCase();
    return (data?.rows ?? []).filter((r) => {
      // اعرض فقط الأصناف الموجودة بالمخزن (إلا إذا طلب عرض الصفرية)
      if (!showZeroStock && Number(r.current_qty) <= 0) return false;
      if (category !== "all" && r.category !== category) return false;
      if (!query && !queryCompact) return true;

      const codeNorm = normalizeArabic(r.item_code).toLowerCase();
      const codeCompact = normalizeItemSearchTerm(r.item_code).toLowerCase();
      const nameNorm = normalizeArabic(r.item_name).toLowerCase();
      const catNorm = normalizeArabic(r.category).toLowerCase();

      return (
        (query && (codeNorm.includes(query) || nameNorm.includes(query) || catNorm.includes(query))) ||
        (queryCompact && codeCompact.includes(queryCompact))
      );
    });
  }, [data?.rows, q, category, showZeroStock]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        acc.opening += r.opening_qty;
        acc.purchased += r.purchased_qty;
        acc.sold += r.sold_qty;
        acc.damaged += r.damaged_qty;
        acc.current += r.current_qty;
        return acc;
      },
      { opening: 0, purchased: 0, sold: 0, damaged: 0, current: 0 },
    );
  }, [filtered]);

  const exportExcel = () => {
    const sheetRows = filtered.map((r) => ({
      "كود الصنف": r.item_code,
      "اسم الصنف": r.item_name,
      "التصنيف": r.category,
      "افتتاحي": r.opening_qty,
      "مشتريات": r.purchased_qty,
      "مبيعات": r.sold_qty,
      "توالف": r.damaged_qty,
      "الرصيد الحالي": r.current_qty,
    }));

    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الرصيد الحالي");

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `inventory_balance_${stamp}.xlsx`);
  };

  const printReport = () => {
    window.print();
  };

  const hasNoRebuild = rebuildStatus && !rebuildStatus.hasRebuild;

  return (
    <main className="min-h-screen bg-background" dir="rtl">
      <header className="border-b bg-background">
        <div className="mx-auto w-full max-w-6xl px-4 py-6">
          <h1 className="text-2xl font-semibold tracking-tight">تقرير الرصيد الحالي للمخزون</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            يعرض البيانات المحسوبة مسبقاً - لتحديث الأرقام اضغط "إعادة بناء البيانات الشاملة" من لوحة التحكم.
          </p>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-4 py-6">
        {/* تحذير إذا لم يتم إعادة البناء */}
        {hasNoRebuild && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>لا توجد بيانات محسوبة</AlertTitle>
            <AlertDescription>
              يرجى الذهاب للوحة التحكم والنقر على "إعادة بناء البيانات الشاملة" للحصول على أرقام المخزون.
            </AlertDescription>
          </Alert>
        )}

        {rebuildStatus?.hasRebuild && (
          <Alert className="mb-4">
            <AlertTitle>آخر إعادة بناء</AlertTitle>
            <AlertDescription>
              {new Date(rebuildStatus.lastRebuildAt!).toLocaleString("ar-KW")} 
              {" "}(الإصدار {rebuildStatus.rebuildVersion} - {rebuildStatus.itemsProcessed} صنف)
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="text-xl">الفلاتر</CardTitle>
            <CardDescription>فلترة حسب التصنيف والبحث، ثم تصدير إلى Excel.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-12">
              <div className="md:col-span-4">
                <label className="mb-1 block text-sm font-medium">التصنيف</label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر التصنيف" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-4">
                <label className="mb-1 block text-sm font-medium">بحث</label>
                <Input
                  ref={qRef}
                  placeholder="كود/اسم/تصنيف — Ctrl+K"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <div className="md:col-span-4 flex items-end gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showZeroStock}
                    onChange={(e) => setShowZeroStock(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm">عرض الأصناف الصفرية</span>
                </label>
              </div>

              <div className="md:col-span-12 flex items-center justify-between gap-3 pt-2">
                <div className="text-sm text-muted-foreground">
                  {isFetching ? "جاري التحديث…" : `${filtered.length} صنف`}
                  {error ? <span className="ms-2">(حدث خطأ في تحميل البيانات)</span> : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={printReport} disabled={hasNoRebuild}>
                    <Printer className="ms-2 h-4 w-4" />
                    طباعة
                  </Button>
                  <Button onClick={exportExcel} disabled={!filtered.length || hasNoRebuild}>
                    <Download className="ms-2 h-4 w-4" />
                    تصدير Excel
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">النتائج</CardTitle>
              <CardDescription>
                الإجماليات: افتتاحي {totals.opening} | مشتريات {totals.purchased} | مبيعات {totals.sold} | توالف {totals.damaged} | الرصيد {totals.current}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hasNoRebuild ? (
                <div className="text-center py-8 text-muted-foreground">
                  لا توجد بيانات. يرجى تنفيذ "إعادة بناء البيانات الشاملة" أولاً.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>كود</TableHead>
                      <TableHead>الصنف</TableHead>
                      <TableHead>التصنيف</TableHead>
                      <TableHead className="text-right">افتتاحي</TableHead>
                      <TableHead className="text-right">مشتريات</TableHead>
                      <TableHead className="text-right">مبيعات</TableHead>
                      <TableHead className="text-right">توالف</TableHead>
                      <TableHead className="text-right">الرصيد الحالي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.item_id}>
                        <TableCell className="font-medium">{r.item_code}</TableCell>
                        <TableCell>{r.item_name}</TableCell>
                        <TableCell>{r.category}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.opening_qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.purchased_qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.sold_qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.damaged_qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.current_qty}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
