import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
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
import { ArrowRight, Plus, Eye } from "lucide-react";

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function WastageList() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const { data: wastages, isLoading } = useQuery({
    queryKey: ["wastages-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wastage_headers")
        .select(
          `
          *,
          wastage_lines(quantity)
        `
        )
        .order("wastage_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filtered = (wastages ?? []).filter((w: any) => {
    const query = q.trim().toLowerCase();
    if (!query) return true;
    return (
      String(w.wastage_no ?? "")
        .toLowerCase()
        .includes(query) ||
      String(w.notes ?? "")
        .toLowerCase()
        .includes(query)
    );
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted p-6" dir="rtl">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate("/")}>
              <ArrowRight className="h-5 w-5" />
            </Button>
            <h1 className="text-3xl font-bold text-foreground">سجل التوالف</h1>
          </div>
          <Button onClick={() => navigate("/wastage/new")}>
            <Plus className="h-4 w-4 ml-2" />
            إضافة تالف
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>قائمة سجلات التوالف</CardTitle>
            <Input
              placeholder="بحث برقم السجل أو الملاحظات..."
              className="max-w-sm mt-2"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground">جاري التحميل…</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم السجل</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead className="text-right">عدد الأصناف</TableHead>
                    <TableHead className="text-right">إجمالي الكمية</TableHead>
                    <TableHead>ملاحظات</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((w: any) => {
                    const linesCount = (w.wastage_lines ?? []).length;
                    const totalQty = (w.wastage_lines ?? []).reduce(
                      (s: number, l: any) => s + toNum(l.quantity),
                      0
                    );
                    return (
                      <TableRow key={w.id}>
                        <TableCell className="font-medium">{w.wastage_no}</TableCell>
                        <TableCell>{w.wastage_date}</TableCell>
                        <TableCell className="text-right tabular-nums">{linesCount}</TableCell>
                        <TableCell className="text-right tabular-nums">{totalQty}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{w.notes ?? "-"}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate(`/wastage/${w.id}`)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        لا توجد سجلات
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
