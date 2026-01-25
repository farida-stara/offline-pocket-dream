import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowRight, Loader2, Plus, Save, X, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { deleteInvoice } from "@/lib/invoiceDelete";
import { downloadSingleInvoicePdf, openSingleInvoicePdf, printSingleInvoicePdf } from "@/lib/invoicePdf";
import { getDisplayQuantities } from "@/lib/salesLineQuantities";
import { useSalesStockPricing } from "@/hooks/useSalesStockPricing";
import { StockBalanceBreakdownDialog } from "@/components/sales/StockBalanceBreakdownDialog";
import { PdfFontHealthBanner } from "@/components/pdf/PdfFontHealthBanner";

const SalesDetails = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  // Default to FULL so the user sees the entire invoice immediately.
  const [viewMode, setViewMode] = useState<"full" | "short">("full");

  const [pdfPending, setPdfPending] = useState(false);

  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownItemId, setBreakdownItemId] = useState<string | null>(null);

  const { data: sale, isLoading } = useQuery({
    queryKey: ["sales-details", id],
    queryFn: async () => {
      if (!id) throw new Error("No ID provided");

      const { data: header, error: headerError } = await supabase
        .from("sales_headers")
        .select(`
          *,
          customer:customers(customer_name, customer_code),
          sales_rep:sales_reps(rep_name)
        `)
        .eq("id", id)
        .single();

      if (headerError) throw headerError;

      const { data: lines, error: linesError } = await supabase
        .from("sales_lines")
        .select(`
          *,
          item:items_master(item_code, item_name, category, selling_price)
        `)
        .eq("sales_header_id", id)
        .order("line_no");

      if (linesError) throw linesError;

      return { header, lines };
    },
    enabled: !!id,
  });

  const { data: items } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items_master")
        .select("id,item_code,item_name,selling_price")
        .eq("is_active", true)
        .order("item_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id,customer_code,customer_name").eq("is_active", true).order("customer_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: salesReps } = useQuery({
    queryKey: ["sales-reps"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_reps")
        .select("id, rep_name")
        .eq("is_active", true)
        .order("rep_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const expectedTotal = useMemo(() => {
    if (!sale) return 0;
    return (sale.lines ?? []).reduce((sum: number, l: any) => {
      const qty = Number(l?.quantity ?? 0);
      const sp = Number(l?.item?.selling_price ?? 0);
      if (!Number.isFinite(qty) || !Number.isFinite(sp)) return sum;
      return sum + qty * sp;
    }, 0);
  }, [sale]);

  const itemIdsForInvoice = useMemo(() => (sale?.lines ?? []).map((l: any) => l.item_id).filter(Boolean), [sale?.lines]);
  const { data: stockPricingMap } = useSalesStockPricing({
    itemIds: itemIdsForInvoice,
    invoiceDate: sale?.header?.invoice_date,
    excludeSalesHeaderId: id,
  });

  const expectedSellingTotal = useMemo(() => {
    if (!sale) return 0;
    return (sale.lines ?? []).reduce((sum: number, line: any) => {
      const q = getDisplayQuantities({ quantity: line.quantity, notes: line.notes ?? null });
      const soldQty = Number(q.sold ?? 0);
      const sp = stockPricingMap?.[line.item_id];
      const purchaseUnit = Number(sp?.lastPurchaseUnitPrice ?? 0);
      const purchaseMarginMultiplier = Number(sp?.lastPurchaseMarginFactor ?? NaN);
      const usedMarginMultiplier = Number.isFinite(purchaseMarginMultiplier) ? purchaseMarginMultiplier : 1.09;
      const expectedUnit = purchaseUnit * usedMarginMultiplier;
      if (!Number.isFinite(soldQty) || !Number.isFinite(expectedUnit)) return sum;
      return sum + soldQty * expectedUnit;
    }, 0);
  }, [sale, stockPricingMap]);

  const expectedDiff = useMemo(() => {
    if (!sale) return 0;
    const actual = Number(sale.header?.total_amount ?? 0);
    return Number(expectedSellingTotal) - actual;
  }, [sale, expectedSellingTotal]);

  const [editHeader, setEditHeader] = useState<any>(null);
  const [editLines, setEditLines] = useState<any[]>([]);

  const startEdit = () => {
    if (!sale) return;
    setEditHeader({
      customer_id: sale.header.customer_id ?? "",
      invoice_date: sale.header.invoice_date,
      payment_method: sale.header.payment_method ?? "cash",
      notes: sale.header.notes ?? "",
      // Preserve non-editable fields so they never get lost on save.
      sales_rep_id: sale.header.sales_rep_id ?? null,
      rep_collects: sale.header.rep_collects ?? false,
    });
    setEditLines(
      (sale.lines ?? []).map((l: any) => ({
        id: l.id,
        item_id: l.item_id,
        quantity: Number(l.quantity ?? 0),
        unit_price: Number(l.unit_price ?? 0),
      })),
    );
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditHeader(null);
    setEditLines([]);
  };

  const removeEditLine = (idx: number) => {
    setEditLines((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  };

  const editTotals = useMemo(() => {
    const actual = editLines.reduce((sum, l) => sum + Number(l.quantity ?? 0) * Number(l.unit_price ?? 0), 0);
    return { actual };
  }, [editLines, items]);

  const saveEditMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("No ID");
      if (!editHeader?.invoice_date) throw new Error("الرجاء إدخال تاريخ الفاتورة");

      const validLines = editLines.filter((l) => l.item_id && Number(l.quantity) > 0 && Number(l.unit_price) > 0);
      if (!validLines.length) throw new Error("الرجاء إضافة سطر واحد على الأقل");

      const totalAmount = validLines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unit_price), 0);

      const { error: headerError } = await supabase
        .from("sales_headers")
        .update({
          customer_id: editHeader.customer_id || null,
          invoice_date: editHeader.invoice_date,
          payment_method: editHeader.payment_method === "other" ? (editHeader.payment_method_other ?? "") : editHeader.payment_method,
          notes: editHeader.notes || null,
          total_amount: totalAmount,
          // Defensive: do not allow these to be nulled out by UI edits.
          sales_rep_id: editHeader.sales_rep_id ?? (sale?.header as any)?.sales_rep_id ?? null,
          rep_collects: Boolean(editHeader.rep_collects ?? (sale?.header as any)?.rep_collects ?? false),
        })
        .eq("id", id);
      if (headerError) throw headerError;

      const { error: delError } = await supabase.from("sales_lines").delete().eq("sales_header_id", id);
      if (delError) throw delError;

      const { error: insError } = await supabase.from("sales_lines").insert(
        validLines.map((l, idx) => ({
          sales_header_id: id,
          line_no: idx + 1,
          item_id: l.item_id,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
        })),
      );
      if (insError) throw insError;
    },
    onSuccess: async () => {
      toast.success("تم تحديث الفاتورة");
      await queryClient.invalidateQueries({ queryKey: ["sales-details", id] });
      await queryClient.invalidateQueries({ queryKey: ["sales-list"] });
      cancelEdit();
    },
    onError: (e: any) => toast.error("خطأ في الحفظ: " + (e?.message || "خطأ غير معروف")),
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: async () => {
      if (!sale) throw new Error("الفاتورة غير موجودة");
      await deleteInvoice({
        id: sale.header.id,
        invoiceNo: sale.header.invoice_no,
        type: "SALES",
      });
    },
    onSuccess: async () => {
      toast.success("تم حذف الفاتورة");
      await queryClient.invalidateQueries({ queryKey: ["sales-list"] });
      navigate("/sales");
    },
    onError: (e: any) => toast.error("خطأ في الحذف: " + (e?.message || "خطأ غير معروف")),
  });

  // IMPORTANT: Hooks must be called unconditionally and in the same order.
  // Keep derived values like filteredLines above any early returns.
  const header = sale?.header as any;
  const lines = (sale?.lines ?? []) as any[];

  const filteredLines = useMemo(() => {
    if (editing) return lines ?? [];
    if (viewMode === "full") return lines ?? [];
    return (lines ?? []).filter((line: any) => {
      const q = getDisplayQuantities({ quantity: line.quantity, notes: line.notes ?? null });
      return Number(q.sold ?? 0) !== 0;
    });
  }, [editing, lines, viewMode]);

  const repName = header?.sales_rep?.rep_name as string | undefined;
  const paymentMethodForPdf = useMemo(() => {
    const method = header?.payment_method || "-";
    // Keep it simple: show the collection rep name in the PDF header via the payment method field.
    if (repName && header?.rep_collects) return `${method} | مندوب التحصيل: ${repName}`;
    if (repName) return `${method} | المندوب: ${repName}`;
    return method;
  }, [header?.payment_method, header?.rep_collects, repName]);

  const buildPdfPayload = () => ({
    title: "فاتورة مبيعات",
    invoiceNo: header.invoice_no,
    date: format(new Date(header.invoice_date), "yyyy-MM-dd"),
    partyLabel: "العميل",
    partyName: header.customer?.customer_name || "مجهول",
    paymentMethod: paymentMethodForPdf,
    notes: header.notes || "",
    totals: {
      totalAmount: Number(header.total_amount || 0),
      expectedSellingTotal: Number(expectedSellingTotal || 0),
    },
    lines: (filteredLines ?? []).map((l: any) => ({
      itemName: l.item?.item_name || l.item?.item_code || "-",
      qty: Number(l.quantity || 0),
      quantities: getDisplayQuantities({ quantity: l.quantity, notes: l.notes ?? null }),
      unitPrice: Number(l.unit_price || 0),
      lineTotal: Number(l.line_total || Number(l.quantity || 0) * Number(l.unit_price || 0)),
    })),
  });

  const handleDownloadPdf = async () => {
    try {
      setPdfPending(true);
      await downloadSingleInvoicePdf(buildPdfPayload());
    } catch (e: any) {
      toast.error("تعذر إنشاء PDF: " + (e?.message || "خطأ غير معروف"));
    } finally {
      setPdfPending(false);
    }
  };

  const handlePreviewPdf = async () => {
    try {
      setPdfPending(true);
      await openSingleInvoicePdf(buildPdfPayload());
    } catch (e: any) {
      toast.error("تعذر فتح معاينة PDF: " + (e?.message || "خطأ غير معروف"));
    } finally {
      setPdfPending(false);
    }
  };

  const handlePrintPdf = async () => {
    try {
      setPdfPending(true);
      await printSingleInvoicePdf(buildPdfPayload());
    } catch (e: any) {
      toast.error("تعذر طباعة PDF: " + (e?.message || "خطأ غير معروف"));
    } finally {
      setPdfPending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!sale) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">الفاتورة غير موجودة</p>
          <Button onClick={() => navigate("/sales")}>العودة للقائمة</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6" dir="rtl">
      <div className="max-w-5xl mx-auto">
        <StockBalanceBreakdownDialog
          open={breakdownOpen}
          onOpenChange={setBreakdownOpen}
          itemId={breakdownItemId}
          invoiceDate={sale?.header?.invoice_date ?? null}
          excludeSalesHeaderId={id ?? null}
        />

        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" onClick={() => navigate("/sales")}>
            <ArrowRight className="h-5 w-5" />
          </Button>
          <h1 className="text-3xl font-bold text-slate-900">تفاصيل فاتورة المبيعات</h1>
          <div className="ms-auto flex gap-2">
            {!editing ? (
              <>
                <Button
                  type="button"
                  variant={viewMode === "full" ? "default" : "outline"}
                  onClick={() => setViewMode("full")}
                >
                  عرض كامل
                </Button>
                <Button
                  type="button"
                  variant={viewMode === "short" ? "default" : "outline"}
                  onClick={() => setViewMode("short")}
                >
                  عرض مختصر
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDownloadPdf}
                  disabled={pdfPending}
                >
                  {pdfPending ? "جاري تجهيز PDF..." : `تحميل PDF ${viewMode === "short" ? "(مختصرة)" : "(كاملة)"}`}
                </Button>
                <Button type="button" variant="outline" onClick={handlePreviewPdf} disabled={pdfPending}>
                  معاينة PDF
                </Button>
                <Button type="button" variant="outline" onClick={handlePrintPdf} disabled={pdfPending}>
                  طباعة
                </Button>
                <Button type="button" variant="outline" onClick={startEdit}>
                  تعديل
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" disabled={deleteInvoiceMutation.isPending}>
                      <Trash2 className="h-4 w-4 ml-2" />
                      حذف الفاتورة
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent dir="rtl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>تأكيد حذف الفاتورة</AlertDialogTitle>
                      <AlertDialogDescription>
                        هل أنت متأكد من حذف فاتورة المبيعات رقم {header.invoice_no}؟ سيتم حذف جميع الأصناف داخلها ولا يمكن التراجع.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>إلغاء</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteInvoiceMutation.mutate()}>
                        حذف
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={cancelEdit}>
                  <X className="h-4 w-4 ml-2" />
                  إلغاء
                </Button>
                <Button type="button" onClick={() => saveEditMutation.mutate()} disabled={saveEditMutation.isPending}>
                  <Save className="h-4 w-4 ml-2" />
                  {saveEditMutation.isPending ? "جاري الحفظ..." : "حفظ التعديل"}
                </Button>
              </>
            )}
          </div>
        </div>

        <PdfFontHealthBanner className="mb-6" />

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>بيانات الفاتورة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">رقم الفاتورة</p>
                <p className="font-semibold">{header.invoice_no}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">التاريخ</p>
                {editing ? (
                  <Input type="date" value={editHeader?.invoice_date ?? ""} onChange={(e) => setEditHeader((h: any) => ({ ...h, invoice_date: e.target.value }))} />
                ) : (
                  <p className="font-semibold">{format(new Date(header.invoice_date), "yyyy-MM-dd")}</p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">العميل</p>
                {editing ? (
                  <select
                    className="w-full p-2 border rounded-md"
                    value={editHeader?.customer_id ?? ""}
                    onChange={(e) => setEditHeader((h: any) => ({ ...h, customer_id: e.target.value }))}
                  >
                    <option value="">مجهول</option>
                    {customers?.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.customer_code} - {c.customer_name}
                      </option>
                    ))}
                  </select>
                ) : (
                   <p className="font-semibold">{header.customer?.customer_name || "مجهول"}</p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">طريقة الدفع</p>
                {editing ? (
                  <select
                    className="w-full p-2 border rounded-md"
                    value={editHeader?.payment_method ?? "cash"}
                    onChange={(e) => setEditHeader((h: any) => ({ ...h, payment_method: e.target.value }))}
                  >
                    <option value="cash">نقداً</option>
                    <option value="knet">كي نت</option>
                    <option value="visa">فيزا</option>
                    <option value="bank_transfer">تحويل بنكي</option>
                    <option value="credit">آجل</option>
                    <option value="other">أخرى…</option>
                  </select>
                ) : (
                  <p className="font-semibold">{header.payment_method || "-"}</p>
                )}
              </div>

              <div>
                <p className="text-sm text-muted-foreground">مندوب المبيعات</p>
                {editing ? (
                  <select
                    className="w-full p-2 border rounded-md"
                    value={editHeader?.sales_rep_id ?? ""}
                    onChange={(e) => setEditHeader((h: any) => ({ ...h, sales_rep_id: e.target.value || null }))}
                  >
                    <option value="">بدون</option>
                    {(salesReps ?? []).map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {r.rep_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="font-semibold">{header.sales_rep?.rep_name || "-"}</p>
                )}
              </div>

              <div>
                <p className="text-sm text-muted-foreground">التحصيل</p>
                {editing ? (
                  <div className="flex items-center gap-2 pt-2">
                    <Checkbox
                      id="rep_collects"
                      checked={Boolean(editHeader?.rep_collects)}
                      onCheckedChange={(v) => setEditHeader((h: any) => ({ ...h, rep_collects: Boolean(v) }))}
                    />
                    <label htmlFor="rep_collects" className="text-sm font-medium">
                      المندوب مسؤول عن التحصيل
                    </label>
                  </div>
                ) : (
                  <p className="font-semibold">{header.rep_collects ? "نعم" : "لا"}</p>
                )}
              </div>
              <div className="col-span-2 md:col-span-4">
                <p className="text-sm text-muted-foreground">ملاحظات</p>
                {editing ? (
                  <Input value={editHeader?.notes ?? ""} onChange={(e) => setEditHeader((h: any) => ({ ...h, notes: e.target.value }))} />
                ) : (
                  <p>{header.notes || "-"}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>الأصناف</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right w-12">#</TableHead>
                    <TableHead className="text-right">كود الصنف</TableHead>
                    <TableHead className="text-right">اسم الصنف</TableHead>
                      <TableHead className="text-center">الكمية المباعه</TableHead>
                      <TableHead className="text-center">مرتجع لعدم البيع</TableHead>
                      <TableHead className="text-center">الكمية المسحوبة</TableHead>
                    <TableHead className="text-left">سعر الوحدة</TableHead>
                    <TableHead className="text-left">الإجمالي</TableHead>
                    <TableHead className="text-center border-s-2 border-amber-400 bg-amber-50">رصيد المخزن</TableHead>
                    <TableHead className="text-center bg-amber-50">سعر الوحدة-شراء</TableHead>
                    <TableHead className="text-center bg-amber-50">هامش %</TableHead>
                    <TableHead className="text-center bg-amber-50">سعر البيع المتوقع للوحدة</TableHead>
                    <TableHead className="text-center bg-amber-50">إجمالي سعر البيع المتوقع</TableHead>
                    <TableHead className="text-center border-e-2 border-amber-400 bg-amber-50">فرق البيع عن المتوقع</TableHead>
                    {editing && <TableHead className="w-12"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!editing
                      ? filteredLines.map((line: any) => {
                          const q = getDisplayQuantities({ quantity: line.quantity, notes: line.notes ?? null });
                          const sp = stockPricingMap?.[line.item_id];
                          const stockBalance = Number(sp?.stockBalance ?? 0);
                          const purchaseUnit = Number(sp?.lastPurchaseUnitPrice ?? 0);
                           const purchaseMarginMultiplier = Number(sp?.lastPurchaseMarginFactor ?? NaN);
                           const purchaseMarginPct = Number.isFinite(purchaseMarginMultiplier)
                             ? (purchaseMarginMultiplier - 1) * 100
                             : NaN;
                           const usedMarginMultiplier = Number.isFinite(purchaseMarginMultiplier) ? purchaseMarginMultiplier : 1.09;
                           const expectedUnit = purchaseUnit * usedMarginMultiplier;
                          const soldQty = Number(q.sold ?? 0);
                          const actualLineTotal = Number(line.line_total || soldQty * Number(line.unit_price || 0));
                          const expectedLineTotal = soldQty * expectedUnit;
                          const diff = expectedLineTotal - actualLineTotal;
                          const stockWarn = soldQty > stockBalance;
                          const diffWarn = diff < 0;

                          return (
                        <TableRow key={line.id}>
                          <TableCell className="text-muted-foreground">{line.line_no}</TableCell>
                          <TableCell className="font-mono">{line.item?.item_code || "-"}</TableCell>
                          <TableCell className="font-medium">{line.item?.item_name || "-"}</TableCell>
                          <TableCell className="text-center tabular-nums">{Number(q.sold || 0).toFixed(3)}</TableCell>
                          <TableCell className="text-center tabular-nums">{Number(q.returned || 0).toFixed(3)}</TableCell>
                          <TableCell className="text-center tabular-nums">{Number(q.withdrawn || 0).toFixed(3)}</TableCell>
                          <TableCell className="text-left tabular-nums">{Number(line.unit_price).toFixed(3)}</TableCell>
                          <TableCell className="text-left tabular-nums font-semibold">
                            {Number(line.line_total || line.quantity * line.unit_price).toFixed(3)}
                          </TableCell>
                           <TableCell
                             className={
                               "text-center tabular-nums border-s-2 border-amber-400 bg-amber-50 " +
                               (stockWarn ? "ring-1 ring-amber-400" : "")
                             }
                           >
                              <button
                                type="button"
                                className="underline underline-offset-4"
                                title="عرض مصدر حساب رصيد المخزن"
                                onClick={() => {
                                  setBreakdownItemId(line.item_id);
                                  setBreakdownOpen(true);
                                }}
                              >
                                {stockBalance.toFixed(3)}
                              </button>
                           </TableCell>
                           <TableCell className="text-center tabular-nums bg-amber-50">
                             {sp?.lastPurchaseHeaderId ? (
                               <button
                                 type="button"
                                 className="underline underline-offset-4"
                                 title={`فتح آخر فاتورة شراء: ${sp?.lastPurchaseInvoiceNo ?? ""}`}
                                 onClick={() => navigate(`/purchases/${sp.lastPurchaseHeaderId}`)}
                               >
                                 {purchaseUnit.toFixed(3)}
                               </button>
                             ) : (
                               purchaseUnit.toFixed(3)
                             )}
                           </TableCell>
                           <TableCell className="text-center tabular-nums bg-amber-50">
                             {Number.isFinite(purchaseMarginPct) ? purchaseMarginPct.toFixed(3) + "%" : "9.000%"}
                           </TableCell>
                           <TableCell className="text-center tabular-nums bg-amber-50">{expectedUnit.toFixed(3)}</TableCell>
                           <TableCell className="text-center tabular-nums bg-amber-50">{expectedLineTotal.toFixed(3)}</TableCell>
                           <TableCell
                             className={
                               "text-center tabular-nums border-e-2 border-amber-400 bg-amber-50 " +
                               (diffWarn ? "text-destructive font-semibold" : "")
                             }
                           >
                             {diff.toFixed(3)}
                           </TableCell>
                        </TableRow>
                          );
                        })
                    : editLines.map((line: any, idx: number) => (
                        <TableRow key={line.id ?? idx}>
                          <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                          <TableCell className="font-mono">
                            <select
                              className="w-full p-2 border rounded-md"
                              value={line.item_id}
                              onChange={(e) =>
                                setEditLines((prev) => prev.map((p, i) => (i === idx ? { ...p, item_id: e.target.value } : p)))
                              }
                            >
                              <option value="">اختر الصنف</option>
                              {(items ?? []).map((it: any) => (
                                <option key={it.id} value={it.id}>
                                  {it.item_code} - {it.item_name}
                                </option>
                              ))}
                            </select>
                          </TableCell>
                          <TableCell className="font-medium">—</TableCell>
                          <TableCell className="text-center">
                            <Input
                              type="number"
                              step="0.001"
                              value={line.quantity}
                              onChange={(e) =>
                                setEditLines((prev) => prev.map((p, i) => (i === idx ? { ...p, quantity: Number(e.target.value || 0) } : p)))
                              }
                            />
                          </TableCell>
                          <TableCell className="text-left tabular-nums">
                            <Input
                              type="number"
                              step="0.001"
                              value={line.unit_price}
                              onChange={(e) =>
                                setEditLines((prev) => prev.map((p, i) => (i === idx ? { ...p, unit_price: Number(e.target.value || 0) } : p)))
                              }
                            />
                          </TableCell>
                          <TableCell className="text-left tabular-nums font-semibold">
                            {(Number(line.quantity || 0) * Number(line.unit_price || 0)).toFixed(3)}
                          </TableCell>
                          {(() => {
                            const sp = stockPricingMap?.[line.item_id];
                            const stockBalance = Number(sp?.stockBalance ?? 0);
                            const purchaseUnit = Number(sp?.lastPurchaseUnitPrice ?? 0);
                            const purchaseMarginMultiplier = Number(sp?.lastPurchaseMarginFactor ?? NaN);
                            const purchaseMarginPct = Number.isFinite(purchaseMarginMultiplier)
                              ? (purchaseMarginMultiplier - 1) * 100
                              : NaN;
                            const usedMarginMultiplier = Number.isFinite(purchaseMarginMultiplier) ? purchaseMarginMultiplier : 1.09;
                            const expectedUnit = purchaseUnit * usedMarginMultiplier;
                            const soldQty = Number(line.quantity ?? 0);
                            const actualLineTotal = soldQty * Number(line.unit_price ?? 0);
                            const expectedLineTotal = soldQty * expectedUnit;
                            const diff = expectedLineTotal - actualLineTotal;
                            const stockWarn = soldQty > stockBalance;
                            const diffWarn = diff < 0;
                            return (
                              <>
                                <TableCell
                                  className={
                                    "text-center tabular-nums border-s-2 border-amber-400 bg-amber-50 " +
                                    (stockWarn ? "ring-1 ring-amber-400" : "")
                                  }
                                >
                                  {stockBalance.toFixed(3)}
                                </TableCell>
                                <TableCell className="text-center tabular-nums bg-amber-50">
                                  {sp?.lastPurchaseHeaderId ? (
                                    <button
                                      type="button"
                                      className="underline underline-offset-4"
                                      title={`فتح آخر فاتورة شراء: ${sp?.lastPurchaseInvoiceNo ?? ""}`}
                                      onClick={() => navigate(`/purchases/${sp.lastPurchaseHeaderId}`)}
                                    >
                                      {purchaseUnit.toFixed(3)}
                                    </button>
                                  ) : (
                                    purchaseUnit.toFixed(3)
                                  )}
                                </TableCell>
                                <TableCell className="text-center tabular-nums bg-amber-50">
                                  {Number.isFinite(purchaseMarginPct) ? purchaseMarginPct.toFixed(3) + "%" : "9.000%"}
                                </TableCell>
                                <TableCell className="text-center tabular-nums bg-amber-50">{expectedUnit.toFixed(3)}</TableCell>
                                <TableCell className="text-center tabular-nums bg-amber-50">{expectedLineTotal.toFixed(3)}</TableCell>
                                <TableCell
                                  className={
                                    "text-center tabular-nums border-e-2 border-amber-400 bg-amber-50 " +
                                    (diffWarn ? "text-destructive font-semibold" : "")
                                  }
                                >
                                  {diff.toFixed(3)}
                                </TableCell>
                              </>
                            );
                          })()}
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeEditLine(idx)}
                              disabled={editLines.length <= 1}
                              title="حذف السطر"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {editing && (
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditLines((prev) => [...prev, { id: crypto.randomUUID(), item_id: "", quantity: 0, unit_price: 0 }])}
            >
              <Plus className="h-4 w-4 ml-2" />
              إضافة سطر
            </Button>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Card className="w-80">
            <CardContent className="p-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold">الإجمالي:</span>
                  <span className="text-xl font-bold tabular-nums">
                    {Number((editing ? editTotals.actual : header.total_amount) || 0).toFixed(3)} د.ك
                  </span>
                </div>

                {!editing && (
                  <>
                    <div className="flex justify-between items-center text-sm text-muted-foreground">
                      <span>إجمالي سعر البيع المتوقع:</span>
                      <span className="tabular-nums">{Number(expectedSellingTotal || 0).toFixed(3)} د.ك</span>
                    </div>
                    <div className="flex justify-between items-center text-sm text-muted-foreground">
                      <span>الفرق (المتوقع - الإجمالي):</span>
                      <span className="tabular-nums">{Number(expectedDiff || 0).toFixed(3)} د.ك</span>
                    </div>
                  </>
                )}

                {!editing && header.notes?.trim() && (
                  <div className="pt-2 border-t text-sm">
                    <span className="font-semibold">ملاحظة: </span>
                    <span>{header.notes}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SalesDetails;
