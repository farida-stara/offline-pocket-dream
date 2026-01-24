import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowRight, Pencil, Plus } from "lucide-react";

type SalesRepRow = {
  id: string;
  rep_code: string | null;
  rep_name: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export default function EmployeesMaster() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SalesRepRow | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [isActive, setIsActive] = useState(true);

  const { data: reps, isLoading } = useQuery({
    queryKey: ["sales-reps-master"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_reps")
        .select("*")
        .order("rep_name");
      if (error) throw error;
      return (data ?? []) as SalesRepRow[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reps ?? [];
    return (reps ?? []).filter((r) => {
      return (
        (r.rep_name ?? "").toLowerCase().includes(q) ||
        (r.rep_code ?? "").toLowerCase().includes(q) ||
        (r.phone ?? "").toLowerCase().includes(q)
      );
    });
  }, [reps, search]);

  const openCreate = () => {
    setEditing(null);
    setCode("");
    setName("");
    setPhone("");
    setIsActive(true);
    setDialogOpen(true);
  };

  const openEdit = (row: SalesRepRow) => {
    setEditing(row);
    setCode(row.rep_code ?? "");
    setName(row.rep_name ?? "");
    setPhone(row.phone ?? "");
    setIsActive(Boolean(row.is_active ?? true));
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const n = name.trim();
      const c = code.trim();
      if (!n) throw new Error("الرجاء إدخال اسم الموظف/المندوب");

      if (editing) {
        const { error } = await supabase
          .from("sales_reps")
          .update({
            rep_name: n,
            rep_code: c || null,
            phone: phone.trim() || null,
            is_active: isActive,
          })
          .eq("id", editing.id);
        if (error) throw error;
        return;
      }

      const { error } = await supabase.from("sales_reps").insert({
        rep_name: n,
        rep_code: c || null,
        phone: phone.trim() || null,
        is_active: isActive,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success(editing ? "تم تحديث الموظف" : "تمت إضافة الموظف");
      setDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-reps-master"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-reps"] }),
      ]);
    },
    onError: (e: any) => toast.error("تعذر الحفظ: " + (e?.message || "خطأ غير معروف")),
  });

  return (
    <main className="min-h-screen bg-background" dir="rtl">
      <header className="border-b bg-background">
        <div className="mx-auto w-full max-w-6xl px-4 py-6">
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate("/")}
              aria-label="العودة للوحة التحكم"
            >
              <ArrowRight className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">سجل الموظفين (المندوبين)</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                إضافة/تعديل الموظفين وربطهم بمندوب المبيعات داخل فواتير المبيعات.
              </p>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-4 py-6">
        <Card className="mb-4">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle>بحث وإضافة</CardTitle>
            <Button type="button" onClick={openCreate}>
              <Plus className="h-4 w-4 ml-2" />
              موظف جديد
            </Button>
          </CardHeader>
          <CardContent>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الكود أو الهاتف…"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">جاري التحميل…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">لا يوجد موظفون مطابقون.</div>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">الكود</TableHead>
                      <TableHead className="text-right">الاسم</TableHead>
                      <TableHead className="text-right">الهاتف</TableHead>
                      <TableHead className="text-right">الحالة</TableHead>
                      <TableHead className="w-14" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.rep_code || "—"}</TableCell>
                        <TableCell>{r.rep_name}</TableCell>
                        <TableCell>{r.phone || "—"}</TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{r.is_active ? "نشط" : "موقوف"}</span>
                        </TableCell>
                        <TableCell>
                          <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(r)} title="تعديل">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل موظف" : "إضافة موظف"}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">كود الموظف (اختياري)</label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="EMP-001" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">اسم الموظف *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الموظف" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">الهاتف</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">الحالة</label>
              <select
                className="w-full p-2 rounded-md border border-input bg-background text-foreground"
                value={isActive ? "active" : "inactive"}
                onChange={(e) => setIsActive(e.target.value === "active")}
              >
                <option value="active">نشط</option>
                <option value="inactive">موقوف</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              إلغاء
            </Button>
            <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "جاري الحفظ..." : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
