import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRight, Loader2 } from "lucide-react";
import { format } from "date-fns";

const SalesDetails = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const { data: sale, isLoading } = useQuery({
    queryKey: ["sales-details", id],
    queryFn: async () => {
      if (!id) throw new Error("No ID provided");

      const { data: header, error: headerError } = await supabase
        .from("sales_headers")
        .select(`
          *,
          customer:customers(customer_name, customer_code)
        `)
        .eq("id", id)
        .single();

      if (headerError) throw headerError;

      const { data: lines, error: linesError } = await supabase
        .from("sales_lines")
        .select(`
          *,
          item:items_master(item_code, item_name, category)
        `)
        .eq("sales_header_id", id)
        .order("line_no");

      if (linesError) throw linesError;

      return { header, lines };
    },
    enabled: !!id,
  });

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

  const { header, lines } = sale;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6" dir="rtl">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" onClick={() => navigate("/sales")}>
            <ArrowRight className="h-5 w-5" />
          </Button>
          <h1 className="text-3xl font-bold text-slate-900">تفاصيل فاتورة المبيعات</h1>
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
                <p className="font-semibold">{format(new Date(header.invoice_date), "yyyy-MM-dd")}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">العميل</p>
                <p className="font-semibold">{header.customer?.customer_name || "بيع نقدي"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">طريقة الدفع</p>
                <p className="font-semibold">{header.payment_method || "-"}</p>
              </div>
              {header.notes && (
                <div className="col-span-2 md:col-span-4">
                  <p className="text-sm text-muted-foreground">ملاحظات</p>
                  <p>{header.notes}</p>
                </div>
              )}
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
                    <TableHead className="text-center">الكمية</TableHead>
                    <TableHead className="text-left">سعر الوحدة</TableHead>
                    <TableHead className="text-left">الإجمالي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line: any) => (
                    <TableRow key={line.id}>
                      <TableCell className="text-muted-foreground">{line.line_no}</TableCell>
                      <TableCell className="font-mono">{line.item?.item_code || "-"}</TableCell>
                      <TableCell className="font-medium">{line.item?.item_name || "-"}</TableCell>
                      <TableCell className="text-center">{line.quantity}</TableCell>
                      <TableCell className="text-left tabular-nums">
                        {Number(line.unit_price).toFixed(3)}
                      </TableCell>
                      <TableCell className="text-left tabular-nums font-semibold">
                        {Number(line.line_total || line.quantity * line.unit_price).toFixed(3)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 flex justify-end">
          <Card className="w-64">
            <CardContent className="p-4">
              <div className="flex justify-between items-center">
                <span className="text-lg font-semibold">الإجمالي:</span>
                <span className="text-xl font-bold tabular-nums">
                  {Number(header.total_amount || 0).toFixed(3)} د.ك
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SalesDetails;
