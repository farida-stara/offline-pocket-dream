import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { downloadSingleInvoicePdf, getSingleInvoicePdfBlob, openPdfBlobInWindow, openPdfWindow, printSingleInvoicePdf } from "@/lib/invoicePdf";
import { RebuildButton } from "@/components/RebuildButton";


const PurchaseDetails = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);

  const [pdfPending, setPdfPending] = useState(false);
  const [refreshPending, setRefreshPending] = useState(false);

  const { data: purchase, isLoading } = useQuery({
    queryKey: ["purchase-details", id],
    queryFn: async () => {
      if (!id) throw new Error("No ID provided");

      const { data: header, error: headerError } = await supabase
        .from("purchase_headers")
        .select(`
          *,
          supplier:suppliers(supplier_name, supplier_code)
        `)
        .eq("id", id)
        .single();

      if (headerError) throw headerError;

      const { data: lines, error: linesError } = await supabase
        .from("purchase_lines")
        .select(`
          *,
          item:items_master(item_code, item_name, category, selling_price)
        `)
        .eq("purchase_header_id", id)
        .order("line_no");

      if (linesError) throw linesError;

      const { data: unmatchedLines, error: unmatchedError } = await supabase
        .from("purchase_unmatched_lines")
        .select("id,line_no,source_name,item_id,quantity_paid,quantity_free,unit_price")
        .eq("purchase_header_id", id)
        .order("line_no");

      if (unmatchedError) throw unmatchedError;

      return { header, lines, unmatchedLines: unmatchedLines ?? [] };
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

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id,supplier_code,supplier_name").eq("is_active", true).order("supplier_name");
      if (error) throw error;
      return data;
    },
  });

  const expectedTotal = useMemo(() => {
    if (!purchase) return 0;
    return (purchase.lines ?? []).reduce((sum: number, l: any) => {
      const qty = Number(l?.quantity_paid ?? 0) + Number(l?.quantity_free ?? 0);
      const sp = Number(l?.item?.selling_price ?? 0);
      if (!Number.isFinite(qty) || !Number.isFinite(sp)) return sum;
      return sum + qty * sp;
    }, 0);
  }, [purchase]);

  const [editHeader, setEditHeader] = useState<any>(null);
  const [editLines, setEditLines] = useState<any[]>([]);
  const [editUnmatched, setEditUnmatched] = useState<any[]>([]);
  const [removedUnmatchedIds, setRemovedUnmatchedIds] = useState<string[]>([]);

  const startEdit = () => {
    if (!purchase) return;
    setEditHeader({
      supplier_id: purchase.header.supplier_id,
      invoice_date: purchase.header.invoice_date,
      payment_method: purchase.header.payment_method ?? "cash",
      notes: purchase.header.notes ?? "",
    });
    setEditLines(
      (purchase.lines ?? []).map((l: any) => ({
        id: l.id,
        item_id: l.item_id,
        quantity_paid: Number(l.quantity_paid ?? 0),
        quantity_free: Number(l.quantity_free ?? 0),
        unit_price: Number(l.unit_price ?? 0),
      })),
    );
    setEditUnmatched((purchase.unmatchedLines ?? []).map((u: any) => ({ ...u })));
    setRemovedUnmatchedIds([]);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditHeader(null);
    setEditLines([]);
    setEditUnmatched([]);
    setRemovedUnmatchedIds([]);
  };

  const removeEditLine = (idx: number) => {
    setEditLines((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  };

  const editTotals = useMemo(() => {
    const actual = editLines.reduce((sum, l) => sum + Number(l.quantity_paid ?? 0) * Number(l.unit_price ?? 0), 0);
    const expected = editLines.reduce((sum, l) => {
      const it = (items ?? []).find((x: any) => x.id === l.item_id);
      const sp = Number((it as any)?.selling_price ?? 0);
      const qty = Number(l.quantity_paid ?? 0) + Number(l.quantity_free ?? 0);
      if (!Number.isFinite(qty) || !Number.isFinite(sp)) return sum;
      return sum + qty * sp;
    }, 0);
    return { actual, expected };
  }, [editLines, items]);

  const saveEditMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("No ID");
      if (!editHeader?.supplier_id || !editHeader?.invoice_date) throw new Error("الرجاء اختيار المورد وتاريخ الفاتورة");

      const validLines = editLines.filter((l) => l.item_id && Number(l.quantity_paid) > 0 && Number(l.unit_price) > 0);
      if (!validLines.length) throw new Error("الرجاء إضافة سطر واحد على الأقل");

      const totalAmount = validLines.reduce((sum, l) => sum + Number(l.quantity_paid) * Number(l.unit_price), 0);

      const { error: headerError } = await supabase
        .from("purchase_headers")
        .update({
          supplier_id: editHeader.supplier_id,
          invoice_date: editHeader.invoice_date,
          payment_method: editHeader.payment_method === "other" ? (editHeader.payment_method_other ?? "") : editHeader.payment_method,
          notes: editHeader.notes || null,
          total_amount: totalAmount,
        })
        .eq("id", id);
      if (headerError) throw headerError;

      // Replace lines to keep it simple
      const { error: delError } = await supabase.from("purchase_lines").delete().eq("purchase_header_id", id);
      if (delError) throw delError;

      const { error: insError } = await supabase.from("purchase_lines").insert(
        validLines.map((l, idx) => ({
          purchase_header_id: id,
          line_no: idx + 1,
          item_id: l.item_id,
          quantity_paid: Number(l.quantity_paid),
          quantity_free: Number(l.quantity_free ?? 0),
          unit_price: Number(l.unit_price),
        })),
      );
      if (insError) throw insError;

      // Remove any unmatched lines that were converted into real lines during edit
      if (removedUnmatchedIds.length > 0) {
        const { error: delUnmatchedError } = await supabase
          .from("purchase_unmatched_lines")
          .delete()
          .in("id", removedUnmatchedIds);
        if (delUnmatchedError) throw delUnmatchedError;
      }

      const remainingUnmatched = editUnmatched.filter((u) => !removedUnmatchedIds.includes(u.id)).length;
      const { error: statusError } = await supabase
        .from("invoice_register")
        .update({ status: remainingUnmatched > 0 ? "needs_review" : "approved" })
        .eq("invoice_type", "PURCHASE")
        .eq("invoice_no", purchase?.header?.invoice_no ?? "");
      if (statusError) throw statusError;
    },
    onSuccess: async () => {
      toast.success("تم تحديث الفاتورة");
      await queryClient.invalidateQueries({ queryKey: ["purchase-details", id] });
      await queryClient.invalidateQueries({ queryKey: ["purchases-list"] });
      cancelEdit();
    },
    onError: (e: any) => toast.error("خطأ في الحفظ: " + (e?.message || "خطأ غير معروف")),
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: async () => {
      if (!purchase) throw new Error("الفاتورة غير موجودة");
      await deleteInvoice({
        id: purchase.header.id,
        invoiceNo: purchase.header.invoice_no,
        type: "PURCHASE",
      });
    },
    onSuccess: async () => {
      toast.success("تم حذف الفاتورة");
      await queryClient.invalidateQueries({ queryKey: ["purchases-list"] });
      navigate("/purchases");
    },
    onError: (e: any) => toast.error("خطأ في الحذف: " + (e?.message || "خطأ غير معروف")),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!purchase) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">الفاتورة غير موجودة</p>
          <Button onClick={() => navigate("/purchases")}>العودة للقائمة</Button>
        </div>
      </div>
    );
  }

  const { header, lines } = purchase;
  const unmatchedLines = (purchase as any).unmatchedLines ?? [];

  const buildPdfPayloadFromPurchase = (p: any) => {
    const header = p?.header as any;
    const lines = (p?.lines ?? []) as any[];

    const expectedSellingTotal = (lines ?? []).reduce((sum: number, l: any) => {
      const qty = Number(l?.quantity_paid ?? 0) + Number(l?.quantity_free ?? 0);
      const sp = Number(l?.item?.selling_price ?? 0);
      if (!Number.isFinite(qty) || !Number.isFinite(sp)) return sum;
      return sum + qty * sp;
    }, 0);

    return {
      title: "فاتورة شراء",
      invoiceNo: header.invoice_no,
      date: format(new Date(header.invoice_date), "yyyy-MM-dd"),
      partyLabel: "المورد",
      partyName: header.supplier?.supplier_name || "-",
      paymentMethod: header.payment_method || "-",
      notes: header.notes || "",
      totals: {
        totalAmount: Number(header.total_amount || 0),
        expectedSellingTotal: Number(expectedSellingTotal || 0),
      },
      lines: (lines ?? []).map((l: any) => ({
        itemName: l.item?.item_name || l.item?.item_code || "-",
        qty: Number(l.quantity_paid || 0) + Number(l.quantity_free || 0),
        unitPrice: Number(l.unit_price || 0),
        lineTotal: Number(l.line_total || Number(l.quantity_paid || 0) * Number(l.unit_price || 0)),
      })),
    };
  };

  const handleRefreshAndPreview = async () => {
    if (!id) return;

    const win = openPdfWindow();
    if (!win) {
      toast.error("المتصفح منع فتح نافذة المعاينة. الرجاء السماح بالنوافذ المنبثقة ثم إعادة المحاولة.");
      return;
    }

    try {
      setRefreshPending(true);
      setPdfPending(true);

      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["purchase-details", id] }),
        queryClient.refetchQueries({ queryKey: ["items"] }),
        queryClient.refetchQueries({ queryKey: ["suppliers"] }),
      ]);

      const freshPurchase = queryClient.getQueryData(["purchase-details", id]) as any;
      if (!freshPurchase?.header) throw new Error("تعذر تحديث بيانات الفاتورة");

      const payload = buildPdfPayloadFromPurchase(freshPurchase);
      const blob = await getSingleInvoicePdfBlob(payload);
      openPdfBlobInWindow(blob, { mode: "preview", targetWindow: win });
    } catch (e: any) {
      try {
        win.close();
      } catch {
        // ignore
      }
      toast.error("تعذر تحديث البيانات/فتح المعاينة: " + (e?.message || "خطأ غير معروف"));
    } finally {
      setPdfPending(false);
      setRefreshPending(false);
    }
  };

  const handlePrintPdf = async () => {
    const win = openPdfWindow();
    if (!win) {
      toast.error("المتصفح منع فتح نافذة الطباعة. الرجاء السماح بالنوافذ المنبثقة ثم إعادة المحاولة.");
      return;
    }

    try {
      setPdfPending(true);
      await printSingleInvoicePdf(buildPdfPayloadFromPurchase({ header, lines, expectedTotal }), win);
    } catch (e: any) {
      try {
        win.close();
      } catch {
        // ignore
      }
      toast.error("تعذر طباعة PDF: " + (e?.message || "خطأ غير معروف"));
    } finally {
      setPdfPending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6" dir="rtl">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" onClick={() => navigate("/purchases")}>
            <ArrowRight className="h-5 w-5" />
          </Button>
          <h1 className="text-3xl font-bold text-foreground">تفاصيل فاتورة الشراء</h1>
          <RebuildButton variant="icon" />
          <div className="ms-auto flex gap-2">
            {!editing ? (
              <>
                <Button type="button" variant="outline" onClick={handleRefreshAndPreview} disabled={refreshPending || pdfPending}>
                  {refreshPending ? "جاري التحديث..." : "تحديث الحسابات ثم معاينة"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    downloadSingleInvoicePdf({
                      title: "فاتورة شراء",
                      invoiceNo: header.invoice_no,
                      date: format(new Date(header.invoice_date), "yyyy-MM-dd"),
                      partyLabel: "المورد",
                      partyName: header.supplier?.supplier_name || "-",
                      paymentMethod: header.payment_method || "-",
                      notes: header.notes || "",
                      totals: {
                        totalAmount: Number(header.total_amount || 0),
                        expectedSellingTotal: Number(expectedTotal || 0),
                      },
                      lines: (lines ?? []).map((l: any) => ({
                        itemName: l.item?.item_name || l.item?.item_code || "-",
                        qty: Number(l.quantity_paid || 0) + Number(l.quantity_free || 0),
                        unitPrice: Number(l.unit_price || 0),
                        lineTotal: Number(l.line_total || Number(l.quantity_paid || 0) * Number(l.unit_price || 0)),
                      })),
                    })
                  }
                >
                  تحميل PDF
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
                        هل أنت متأكد من حذف فاتورة الشراء رقم {header.invoice_no}؟ سيتم حذف جميع الأصناف داخلها ولا يمكن التراجع.
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
                <p className="text-sm text-muted-foreground">المورد</p>
                {editing ? (
                  <select
                    className="w-full p-2 border rounded-md"
                    value={editHeader?.supplier_id ?? ""}
                    onChange={(e) => setEditHeader((h: any) => ({ ...h, supplier_id: e.target.value }))}
                  >
                    <option value="">اختر المورد</option>
                    {suppliers?.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.supplier_code} - {s.supplier_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="font-semibold">{header.supplier?.supplier_name || "-"}</p>
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
                    <option value="cash">نقد</option>
                    <option value="card">بطاقة</option>
                    <option value="transfer">تحويل</option>
                    <option value="credit">آجل</option>
                    <option value="other">أخرى…</option>
                  </select>
                ) : (
                  <p className="font-semibold">{header.payment_method || "-"}</p>
                )}
              </div>
              <div className="col-span-2 md:col-span-4">
                <p className="text-sm text-muted-foreground">ملاحظات</p>
                {editing ? (
                  <Input value={editHeader?.notes ?? ""} onChange={(e) => setEditHeader((h: any) => ({ ...h, notes: e.target.value }))} placeholder="" />
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
                    <TableHead className="text-center">الكمية المدفوعة</TableHead>
                    <TableHead className="text-center">الكمية المجانية</TableHead>
                    <TableHead className="text-left">سعر الوحدة</TableHead>
                    <TableHead className="text-left">الإجمالي</TableHead>
                    {editing && <TableHead className="w-12"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!editing
                    ? lines.map((line: any) => (
                        <TableRow key={line.id}>
                          <TableCell className="text-muted-foreground">{line.line_no}</TableCell>
                          <TableCell className="font-mono">{line.item?.item_code || "-"}</TableCell>
                          <TableCell className="font-medium">{line.item?.item_name || "-"}</TableCell>
                          <TableCell className="text-center">{line.quantity_paid}</TableCell>
                          <TableCell className="text-center">{line.quantity_free || 0}</TableCell>
                          <TableCell className="text-left tabular-nums">{Number(line.unit_price).toFixed(3)}</TableCell>
                          <TableCell className="text-left tabular-nums font-semibold">
                            {Number(line.line_total || line.quantity_paid * line.unit_price).toFixed(3)}
                          </TableCell>
                        </TableRow>
                      ))
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
                              value={line.quantity_paid}
                              onChange={(e) =>
                                setEditLines((prev) => prev.map((p, i) => (i === idx ? { ...p, quantity_paid: Number(e.target.value || 0) } : p)))
                              }
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Input
                              type="number"
                              step="0.001"
                              value={line.quantity_free}
                              onChange={(e) =>
                                setEditLines((prev) => prev.map((p, i) => (i === idx ? { ...p, quantity_free: Number(e.target.value || 0) } : p)))
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
                            {(Number(line.quantity_paid || 0) * Number(line.unit_price || 0)).toFixed(3)}
                          </TableCell>
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

        {unmatchedLines.length > 0 && (
          <Card className="mt-6 ring-1 ring-accent/30">
            <CardHeader>
              <CardTitle>أصناف غير مطابقة (بحاجة لمراجعة)</CardTitle>
            </CardHeader>
            <CardContent>
              {!editing ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right w-12">#</TableHead>
                        <TableHead className="text-right">اسم/كود من الملف</TableHead>
                        <TableHead className="text-center">المدفوعة</TableHead>
                        <TableHead className="text-center">المجانية</TableHead>
                        <TableHead className="text-left">سعر الشراء</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unmatchedLines.map((u: any) => (
                        <TableRow key={u.id}>
                          <TableCell className="text-muted-foreground">{u.line_no}</TableCell>
                          <TableCell className="font-medium">{u.source_name || "-"}</TableCell>
                          <TableCell className="text-center">{Number(u.quantity_paid ?? 0)}</TableCell>
                          <TableCell className="text-center">{Number(u.quantity_free ?? 0)}</TableCell>
                          <TableCell className="text-left tabular-nums">{Number(u.unit_price ?? 0).toFixed(3)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="space-y-3">
                  {editUnmatched
                    .filter((u) => !removedUnmatchedIds.includes(u.id))
                    .map((u: any) => (
                      <div key={u.id} className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-5">
                          <p className="text-xs text-muted-foreground">غير مطابق</p>
                          <p className="text-sm font-medium">{u.source_name || "-"}</p>
                          <p className="text-xs text-muted-foreground">
                            مدفوعة: {Number(u.quantity_paid ?? 0)} | مجانية: {Number(u.quantity_free ?? 0)} | سعر: {Number(u.unit_price ?? 0).toFixed(3)}
                          </p>
                        </div>
                        <div className="col-span-5">
                          <label className="text-xs font-medium mb-1 block">اختيار الصنف الصحيح</label>
                          <select
                            className="w-full p-2 border rounded-md"
                            value={u.item_id ?? ""}
                            onChange={(e) => setEditUnmatched((prev) => prev.map((p) => (p.id === u.id ? { ...p, item_id: e.target.value } : p)))}
                          >
                            <option value="">اختر الصنف</option>
                            {(items ?? []).map((it: any) => (
                              <option key={it.id} value={it.id}>
                                {it.item_code} - {it.item_name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-2 flex justify-end">
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={!u.item_id}
                            onClick={() => {
                              setEditLines((prev) => [
                                ...prev,
                                {
                                  id: crypto.randomUUID(),
                                  item_id: u.item_id,
                                  quantity_paid: Number(u.quantity_paid ?? 0),
                                  quantity_free: Number(u.quantity_free ?? 0),
                                  unit_price: Number(u.unit_price ?? 0),
                                },
                              ]);
                              setRemovedUnmatchedIds((prev) => [...prev, u.id]);
                            }}
                          >
                            إضافة
                          </Button>
                        </div>
                      </div>
                    ))}
                  {editUnmatched.filter((u) => !removedUnmatchedIds.includes(u.id)).length === 0 && (
                    <div className="text-sm text-muted-foreground">لا توجد أصناف غير مطابقة متبقية.</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {editing && (
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditLines((prev) => [...prev, { id: crypto.randomUUID(), item_id: "", quantity_paid: 0, quantity_free: 0, unit_price: 0 }])}
            >
              <Plus className="h-4 w-4 ml-2" />
              إضافة سطر
            </Button>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Card className="w-64">
            <CardContent className="p-4">
              <div className="flex justify-between items-center">
                <span className="text-lg font-semibold">الإجمالي:</span>
                <span className="text-xl font-bold tabular-nums">
                  {Number((editing ? editTotals.actual : header.total_amount) || 0).toFixed(3)} د.ك
                </span>
              </div>
              <div className="mt-2 flex justify-between items-center">
                <span className="text-sm text-muted-foreground">البيع المتوقع:</span>
                <span className="text-sm font-semibold tabular-nums">
                  {Number((editing ? editTotals.expected : expectedTotal) || 0).toFixed(3)} د.ك
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default PurchaseDetails;
