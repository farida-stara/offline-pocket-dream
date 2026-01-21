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
import { ArrowRight, Search, Plus, Eye, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { deleteInvoice } from "@/lib/invoiceDelete";

const PurchasesList = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; invoiceNo: string } | null>(null);

  const { data: purchases, isLoading } = useQuery({
    queryKey: ["purchases-list", search, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from("purchase_headers")
        .select(
          `
          *,
           supplier:suppliers(supplier_name, supplier_code),
           lines:purchase_lines(quantity_paid, quantity_free, item:items_master(selling_price))
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
        type: "PURCHASE",
      });
    },
    onSuccess: async () => {
      toast.success("تم حذف الفاتورة");
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["purchases-list"] });
    },
    onError: (e: any) => toast.error("خطأ في الحذف: " + (e?.message || "خطأ غير معروف")),
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
              سجل فواتير المشتريات
            </h1>
          </div>
          <Button onClick={() => navigate("/purchases/new")}>
            <Plus className="h-4 w-4 ml-2" />
            فاتورة جديدة
          </Button>
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
            ) : !purchases?.length ? (
              <div className="p-8 text-center text-muted-foreground">
                لا توجد فواتير مشتريات
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">رقم الفاتورة</TableHead>
                      <TableHead className="text-right">التاريخ</TableHead>
                      <TableHead className="text-right">المورد</TableHead>
                      <TableHead className="text-right">طريقة الدفع</TableHead>
                      <TableHead className="text-left">الإجمالي</TableHead>
                      <TableHead className="text-left">إجمالي البيع المتوقع</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchases.map((p) => (
                      (() => {
                        const expected = (p.lines ?? []).reduce((sum: number, l: any) => {
                          const qty = Number(l?.quantity_paid ?? 0) + Number(l?.quantity_free ?? 0);
                          const sp = Number(l?.item?.selling_price ?? 0);
                          if (!Number.isFinite(qty) || !Number.isFinite(sp)) return sum;
                          return sum + qty * sp;
                        }, 0);

                        return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">
                          {p.invoice_no}
                        </TableCell>
                        <TableCell>
                          {format(new Date(p.invoice_date), "yyyy-MM-dd")}
                        </TableCell>
                        <TableCell>
                          {p.supplier?.supplier_name || "-"}
                        </TableCell>
                        <TableCell>{p.payment_method || "-"}</TableCell>
                        <TableCell className="text-left tabular-nums">
                          {Number(p.total_amount || 0).toFixed(3)} د.ك
                        </TableCell>
                        <TableCell className="text-left tabular-nums">
                          {expected.toFixed(3)} د.ك
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              navigate(`/purchases/${p.id}`)
                            }
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget({ id: p.id, invoiceNo: p.invoice_no })}
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
          إجمالي الفواتير المعروضة: {purchases?.length ?? 0}
        </div>
      </div>
    </div>
  );
};

export default PurchasesList;
