import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRight, Search, Plus, Eye, Trash2, Printer } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { deleteInvoice } from "@/lib/invoiceDelete";
import { downloadInvoicesPdf, downloadSingleInvoicePdf } from "@/lib/invoicePdf";
import { getDisplayQuantities } from "@/lib/salesLineQuantities";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const SalesList = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; invoiceNo: string } | null>(null);

  const { data: sales, isLoading } = useQuery({
    queryKey: ["sales-list", search, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from("sales_headers")
        .select(
          `
          *,
           customer:customers(customer_name, customer_code),
           lines:sales_lines(quantity, item:items_master(selling_price))
        `
        )
        .order("invoice_date", { ascending: false })
        .limit(200);

      if (search) {
        query = query.ilike("invoice_no", `%${search}%`);
      }

      if (dateFrom) {
        query = query.gte("invoice_date", dateFrom);
      }

      if (dateTo) {
        query = query.lte("invoice_date", dateTo);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) return;
      await deleteInvoice({
        id: deleteTarget.id,
        invoiceNo: deleteTarget.invoiceNo,
        type: "SALES",
      });
    },
    onSuccess: async () => {
      toast.success("تم حذف الفاتورة");
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["sales-list"] });
    },
    onError: (e: any) => toast.error("خطأ في الحذف: " + (e?.message || "خطأ غير معروف")),
  });

  const exportPdfMutation = useMutation({
    mutationFn: async ({ mode }: { mode: "full" | "short" }) => {
      let q = supabase
        .from("sales_headers")
        .select(
          `
          id, invoice_no, invoice_date, total_amount, payment_method, notes,
          customer:customers(customer_name)
        `,
        )
        .order("invoice_date", { ascending: false })
        .limit(200);

      if (search) q = q.ilike("invoice_no", `%${search}%`);
      if (dateFrom) q = q.gte("invoice_date", dateFrom);
      if (dateTo) q = q.lte("invoice_date", dateTo);

      const { data: headers, error: headersError } = await q;
      if (headersError) throw headersError;
      if (!headers?.length) throw new Error("لا توجد فواتير للطباعة");

      const ids = headers.map((h) => h.id);
      const { data: lines, error: linesError } = await supabase
        .from("sales_lines")
        .select(
          `
          sales_header_id, quantity, unit_price, line_total, notes,
          item:items_master(item_name, item_code, selling_price)
        `,
        )
        .in("sales_header_id", ids)
        .order("line_no");
      if (linesError) throw linesError;

      const byHeader = new Map<string, any[]>();
      (lines ?? []).forEach((l: any) => {
        const key = l.sales_header_id;
        byHeader.set(key, [...(byHeader.get(key) ?? []), l]);
      });

      const invoices = headers.map((h: any) => {
        const rawLines = byHeader.get(h.id) ?? [];
        const lns =
          mode === "short"
            ? rawLines.filter((l: any) => {
                const q = getDisplayQuantities({ quantity: l.quantity, notes: l.notes ?? null });
                return Number(q.sold ?? 0) !== 0;
              })
            : rawLines;

        const expectedSellingTotal = lns.reduce((sum: number, l: any) => {
          const q = getDisplayQuantities({ quantity: l.quantity, notes: l.notes ?? null });
          const soldQty = Number(q.sold ?? 0);
          const sp = Number(l.item?.selling_price ?? 0);
          if (!Number.isFinite(soldQty) || !Number.isFinite(sp)) return sum;
          return sum + soldQty * sp;
        }, 0);

        return {
          title: "فاتورة مبيعات",
          invoiceNo: h.invoice_no,
          date: format(new Date(h.invoice_date), "yyyy-MM-dd"),
          partyLabel: "العميل",
          partyName: h.customer?.customer_name || "مجهول",
          paymentMethod: h.payment_method || "-",
          notes: h.notes || "",
          totals: {
            totalAmount: Number(h.total_amount || 0),
            expectedSellingTotal,
          },
          lines: lns.map((l: any) => ({
            itemName: l.item?.item_name || l.item?.item_code || "-",
            qty: Number(l.quantity ?? 0),
            quantities: getDisplayQuantities({ quantity: l.quantity, notes: l.notes ?? null }),
            unitPrice: Number(l.unit_price ?? 0),
            lineTotal: Number(l.line_total || Number(l.quantity ?? 0) * Number(l.unit_price ?? 0)),
          })),
        };
      });

      const fromPart = dateFrom || "all";
      const toPart = dateTo || "all";
      const fileName = `sales_${fromPart}_${toPart}_${mode === "short" ? "short" : "full"}.pdf`;
      await downloadInvoicesPdf(fileName, invoices);
    },
    onError: (e: any) => toast.error("تعذر إنشاء PDF: " + (e?.message || "خطأ غير معروف")),
  });

  const printOneMutation = useMutation({
    mutationFn: async ({ id, mode }: { id: string; mode: "full" | "short" }) => {
      const { data: header, error: headerError } = await supabase
        .from("sales_headers")
        .select(
          `
          id, invoice_no, invoice_date, total_amount, payment_method, notes,
          customer:customers(customer_name)
        `,
        )
        .eq("id", id)
        .single();
      if (headerError) throw headerError;

      const { data: lines, error: linesError } = await supabase
        .from("sales_lines")
        .select(
          `
          quantity, unit_price, line_total, notes,
          item:items_master(item_name, item_code)
        `,
        )
        .eq("sales_header_id", id)
        .order("line_no");
      if (linesError) throw linesError;

      const filtered =
        mode === "short"
          ? (lines ?? []).filter((l: any) => {
              const q = getDisplayQuantities({ quantity: l.quantity, notes: l.notes ?? null });
              return Number(q.sold ?? 0) !== 0;
            })
          : (lines ?? []);

      await downloadSingleInvoicePdf({
        title: "فاتورة مبيعات",
        invoiceNo: header.invoice_no,
        date: format(new Date(header.invoice_date), "yyyy-MM-dd"),
        partyLabel: "العميل",
        partyName: header.customer?.customer_name || "مجهول",
        paymentMethod: header.payment_method || "-",
        notes: header.notes || "",
        totals: {
          totalAmount: Number(header.total_amount || 0),
        },
        lines: filtered.map((l: any) => ({
          itemName: l.item?.item_name || l.item?.item_code || "-",
          qty: Number(l.quantity ?? 0),
          quantities: getDisplayQuantities({ quantity: l.quantity, notes: l.notes ?? null }),
          unitPrice: Number(l.unit_price ?? 0),
          lineTotal: Number(l.line_total || Number(l.quantity ?? 0) * Number(l.unit_price ?? 0)),
        })),
      });
    },
    onError: (e: any) => toast.error("تعذر طباعة الفاتورة: " + (e?.message || "خطأ غير معروف")),
  });

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6"
      dir="rtl"
    >
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate("/")}>
              <ArrowRight className="h-5 w-5" />
            </Button>
            <h1 className="text-3xl font-bold text-slate-900">
              سجل فواتير المبيعات
            </h1>
          </div>
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" disabled={exportPdfMutation.isPending}>
                  <Printer className="h-4 w-4 ml-2" />
                  {exportPdfMutation.isPending ? "جاري تجهيز PDF..." : "تحميل PDF"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => exportPdfMutation.mutate({ mode: "full" })}>
                  تحميل PDF (كاملة)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportPdfMutation.mutate({ mode: "short" })}>
                  تحميل PDF (مختصرة)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => navigate("/sales/new")}>
              <Plus className="h-4 w-4 ml-2" />
              فاتورة جديدة
            </Button>
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">فلترة البحث</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">
                  رقم الفاتورة
                </label>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="بحث..."
                    className="pr-10"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">من تاريخ</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">إلى تاريخ</label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>

              <div className="flex items-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setDateFrom("");
                    setDateTo("");
                  }}
                >
                  مسح الفلتر
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">
                جاري التحميل...
              </div>
            ) : !sales?.length ? (
              <div className="p-8 text-center text-muted-foreground">
                لا توجد فواتير مبيعات
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">رقم الفاتورة</TableHead>
                      <TableHead className="text-right">التاريخ</TableHead>
                      <TableHead className="text-right">العميل</TableHead>
                      <TableHead className="text-right">طريقة الدفع</TableHead>
                      <TableHead className="text-left">الإجمالي</TableHead>
                      <TableHead className="text-left">إجمالي البيع المتوقع</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sales.map((s) => (
                      (() => {
                        const expected = (s.lines ?? []).reduce((sum: number, l: any) => {
                          const qty = Number(l?.quantity ?? 0);
                          const sp = Number(l?.item?.selling_price ?? 0);
                          if (!Number.isFinite(qty) || !Number.isFinite(sp)) return sum;
                          return sum + qty * sp;
                        }, 0);

                        return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">
                          {s.invoice_no}
                        </TableCell>
                        <TableCell>
                          {format(new Date(s.invoice_date), "yyyy-MM-dd")}
                        </TableCell>
                        <TableCell>
                          {s.customer?.customer_name || "مجهول"}
                        </TableCell>
                        <TableCell>{s.payment_method || "-"}</TableCell>
                        <TableCell className="text-left tabular-nums">
                          {Number(s.total_amount || 0).toFixed(3)} د.ك
                        </TableCell>
                        <TableCell className="text-left tabular-nums">
                          {expected.toFixed(3)} د.ك
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/sales/${s.id}`)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" title="طباعة PDF">
                                <Printer className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem onClick={() => printOneMutation.mutate({ id: s.id, mode: "full" })}>
                                طباعة PDF (كاملة)
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => printOneMutation.mutate({ id: s.id, mode: "short" })}>
                                طباعة PDF (مختصرة)
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget({ id: s.id, invoiceNo: s.invoice_no })}
                            title="حذف الفاتورة"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                        );
                      })()
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>تأكيد حذف الفاتورة</AlertDialogTitle>
              <AlertDialogDescription>
                هل أنت متأكد من حذف هذه الفاتورة؟ سيتم حذف جميع الأصناف داخلها ولا يمكن التراجع.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>إلغاء</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
                حذف
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="mt-4 text-sm text-muted-foreground text-center">
          إجمالي الفواتير المعروضة: {sales?.length ?? 0}
        </div>
      </div>
    </div>
  );
};

export default SalesList;
