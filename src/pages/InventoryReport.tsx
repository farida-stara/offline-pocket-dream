import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Download } from "lucide-react";
import { normalizeArabic } from "@/lib/fuzzy";
import { normalizeItemSearchTerm } from "@/lib/itemSearch";
import { fetchOpeningBaselineDate } from "@/lib/openingBaseline";

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
};

function toNum(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function InventoryReport() {
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [useStockDate, setUseStockDate] = useState(false);
  const [stockDate, setStockDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<string>("all");
  const [q, setQ] = useState<string>("");
  const qRef = useRef<HTMLInputElement | null>(null);

  // (من تاريخ) ثابت = تاريخ الرصيد الافتتاحي (بداية العمل)
  const { data: openingBaselineDate } = useQuery({
    queryKey: ["opening-baseline-date"],
    queryFn: fetchOpeningBaselineDate,
  });

  useEffect(() => {
    if (openingBaselineDate && fromDate !== openingBaselineDate) {
      setFromDate(openingBaselineDate);
    }
  }, [openingBaselineDate]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        qRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const { data, isFetching, error } = useQuery({
    queryKey: ["reports", "inventory-balance", { fromDate, toDate, useStockDate, stockDate }],
    queryFn: async () => {
      const baselineDate = (await fetchOpeningBaselineDate()) ?? "0001-01-01";
      const today = new Date().toISOString().slice(0, 10);
      const endDate = useStockDate ? (stockDate || today) : (toDate || today);

      const [{ data: items, error: itemsError }, { data: opening, error: openingError }] = await Promise.all([
        supabase
          .from("items_master")
          .select("id,item_code,item_name,category,is_active")
          .eq("is_active", true)
          .order("item_code", { ascending: true }),
        supabase.from("opening_stock").select("item_id,quantity").eq("entry_date", baselineDate),
      ]);

      if (itemsError) throw itemsError;
      if (openingError) throw openingError;

      const purchaseQuery = supabase
        .from("purchase_lines")
        .select("item_id,quantity_paid,quantity_free,purchase_headers!inner(invoice_date)");
      const salesQuery = supabase
        .from("sales_lines")
        .select("item_id,quantity,sales_headers!inner(invoice_date)");
      const wastageQuery = supabase
        .from("wastage_lines")
        .select("item_id,quantity,wastage_headers!inner(wastage_date)");

      if (useStockDate) {
        purchaseQuery.gte("purchase_headers.invoice_date", baselineDate);
        salesQuery.gte("sales_headers.invoice_date", baselineDate);
        wastageQuery.gte("wastage_headers.wastage_date", baselineDate);
        purchaseQuery.lte("purchase_headers.invoice_date", endDate);
        salesQuery.lte("sales_headers.invoice_date", endDate);
        wastageQuery.lte("wastage_headers.wastage_date", endDate);
      } else {
        if (fromDate) {
          purchaseQuery.gte("purchase_headers.invoice_date", fromDate);
          salesQuery.gte("sales_headers.invoice_date", fromDate);
          wastageQuery.gte("wastage_headers.wastage_date", fromDate);
        }
        purchaseQuery.lte("purchase_headers.invoice_date", endDate);
        salesQuery.lte("sales_headers.invoice_date", endDate);
        wastageQuery.lte("wastage_headers.wastage_date", endDate);
      }

      const [
        { data: purchases, error: purchasesError },
        { data: sales, error: salesError },
        { data: wastages, error: wastagesError },
      ] = await Promise.all([purchaseQuery, salesQuery, wastageQuery]);

      if (purchasesError) throw purchasesError;
      if (salesError) throw salesError;
      if (wastagesError) throw wastagesError;

      const openingByItem = new Map<string, number>();
      for (const r of opening ?? []) {
        openingByItem.set(r.item_id, (openingByItem.get(r.item_id) ?? 0) + toNum(r.quantity));
      }

      const purchasedByItem = new Map<string, number>();
      for (const r of purchases ?? []) {
        const paid = toNum((r as any).quantity_paid);
        const free = toNum((r as any).quantity_free);
        purchasedByItem.set(r.item_id, (purchasedByItem.get(r.item_id) ?? 0) + paid + free);
      }

      const soldByItem = new Map<string, number>();
      for (const r of sales ?? []) {
        soldByItem.set(r.item_id, (soldByItem.get(r.item_id) ?? 0) + toNum((r as any).quantity));
      }

      const damagedByItem = new Map<string, number>();
      for (const r of wastages ?? []) {
        damagedByItem.set(r.item_id, (damagedByItem.get(r.item_id) ?? 0) + toNum((r as any).quantity));
      }

      const rows: Row[] = (items ?? []).map((it) => {
        const opening_qty = openingByItem.get(it.id) ?? 0;
        const purchased_qty = purchasedByItem.get(it.id) ?? 0;
        const sold_qty = soldByItem.get(it.id) ?? 0;
        const damaged_qty = damagedByItem.get(it.id) ?? 0;
        const current_qty = opening_qty + purchased_qty - sold_qty - damaged_qty;
        return {
          item_id: it.id,
          item_code: it.item_code,
          item_name: it.item_name,
          category: it.category,
          opening_qty,
          purchased_qty,
          sold_qty,
          damaged_qty,
          current_qty,
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
  }, [data?.rows, q, category]);

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

  return (
    <main className="min-h-screen bg-background" dir="rtl">
      <header className="border-b bg-background">
        <div className="mx-auto w-full max-w-6xl px-4 py-6">
          <h1 className="text-2xl font-semibold tracking-tight">تقرير الرصيد الحالي للمخزون</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            الرصيد = افتتاحي (ثابت) + مشتريات(حتى التاريخ المحدد) − مبيعات(حتى التاريخ المحدد) − توالف (حتى التاريخ المحدد).
          </p>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-4 py-6">
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="text-xl">الفلاتر</CardTitle>
            <CardDescription>فلترة حسب التاريخ/التصنيف والبحث، ثم تصدير إلى Excel.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-12">
              <div className="md:col-span-12 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Switch checked={useStockDate} onCheckedChange={setUseStockDate} />
                  <div>
                    <div className="text-sm font-medium">تاريخ رصيد</div>
                    <div className="text-xs text-muted-foreground">
                      عند التفعيل: يحسب الرصيد حتى Stock Date من تاريخ الافتتاحي الثابت.
                    </div>
                  </div>
                </div>

                {useStockDate ? (
                  <div className="w-full max-w-xs">
                    <label className="mb-1 block text-sm font-medium">Stock Date</label>
                    <Input type="date" value={stockDate} onChange={(e) => setStockDate(e.target.value)} />
                  </div>
                ) : null}
              </div>

              <div className="md:col-span-3">
                <label className="mb-1 block text-sm font-medium">من تاريخ</label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  disabled
                />
              </div>
              <div className="md:col-span-3">
                <label className="mb-1 block text-sm font-medium">إلى تاريخ</label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} disabled={useStockDate} />
              </div>
              <div className="md:col-span-3">
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
              <div className="md:col-span-3">
                <label className="mb-1 block text-sm font-medium">بحث</label>
                <Input
                  ref={qRef}
                  placeholder="كود/اسم/تصنيف — Ctrl+K"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>

              <div className="md:col-span-12 flex items-center justify-between gap-3 pt-2">
                <div className="text-sm text-muted-foreground">
                  {isFetching ? "جاري التحديث…" : `${filtered.length} صنف`}
                  {error ? <span className="ms-2">(حدث خطأ في تحميل البيانات)</span> : null}
                </div>
                <Button onClick={exportExcel} disabled={!filtered.length}>
                  <Download className="ms-2 h-4 w-4" />
                  تصدير Excel
                </Button>
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
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
