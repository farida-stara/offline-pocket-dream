import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ArrowRight, Trash2 } from "lucide-react";
import { toast } from "sonner";

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function WastageDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: header, isLoading } = useQuery({
    queryKey: ["wastage-detail", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wastage_headers")
        .select(
          `
          *,
          wastage_lines(
            *,
            items_master(item_code, item_name),
            wastage_reasons(reason_name)
          )
        `
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Missing id");
      const { error } = await supabase.from("wastage_headers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حذف سجل التالف بنجاح");
      queryClient.invalidateQueries({ queryKey: ["wastages-list"] });
      navigate("/wastage");
    },
    onError: (e: any) => {
      toast.error("خطأ في الحذف: " + e.message);
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        جاري التحميل...
      </div>
    );
  }

  if (!header) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        سجل التوالف غير موجود
      </div>
    );
  }

  const lines = (header as any).wastage_lines ?? [];
  const totalQty = lines.reduce((s: number, l: any) => s + toNum(l.quantity), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted p-6" dir="rtl">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate("/wastage")}>
              <ArrowRight className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold text-foreground">
              تفاصيل سجل التالف: {header.wastage_no}
            </h1>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="h-4 w-4 ml-2" />
                حذف السجل
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent dir="rtl">
              <AlertDialogHeader>
                <AlertDialogTitle>هل أنت متأكد؟</AlertDialogTitle>
                <AlertDialogDescription>
                  سيتم حذف سجل التوالف "{header.wastage_no}" نهائياً.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground"
                  onClick={() => deleteMutation.mutate()}
                >
                  حذف
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>معلومات السجل</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">رقم السجل</p>
              <p className="font-medium">{header.wastage_no}</p>
            </div>
            <div>
              <p className="text-muted-foreground">التاريخ</p>
              <p className="font-medium">{header.wastage_date}</p>
            </div>
            <div>
              <p className="text-muted-foreground">عدد الأصناف</p>
              <p className="font-medium">{lines.length}</p>
            </div>
            <div>
              <p className="text-muted-foreground">إجمالي الكمية</p>
              <p className="font-medium tabular-nums">{totalQty}</p>
            </div>
            {header.notes && (
              <div className="col-span-full">
                <p className="text-muted-foreground">ملاحظات</p>
                <p className="font-medium">{header.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>الأصناف التالفة</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>م</TableHead>
                  <TableHead>كود الصنف</TableHead>
                  <TableHead>اسم الصنف</TableHead>
                  <TableHead className="text-right">الكمية</TableHead>
                  <TableHead>سبب التلف</TableHead>
                  <TableHead>ملاحظات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line: any, idx: number) => (
                  <TableRow key={line.id}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell className="font-medium">
                      {line.items_master?.item_code ?? "-"}
                    </TableCell>
                    <TableCell>{line.items_master?.item_name ?? "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{toNum(line.quantity)}</TableCell>
                    <TableCell>{line.wastage_reasons?.reason_name ?? "-"}</TableCell>
                    <TableCell className="max-w-[150px] truncate">{line.notes ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
