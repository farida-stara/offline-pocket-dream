import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowRight, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

type CustomerRow = {
  id: string;
  customer_code: string;
  customer_name: string;
  phone: string | null;
  address: string | null;
  email: string | null;
  is_active: boolean | null;
  created_at: string | null;
};

export default function CustomersMaster() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [isActive, setIsActive] = useState(true);

  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("customer_name");
      if (error) throw error;
      return data as CustomerRow[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers ?? [];
    return (customers ?? []).filter((c) => {
      return (
        c.customer_code.toLowerCase().includes(q) ||
        c.customer_name.toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [customers, search]);

  const openCreate = () => {
    setEditing(null);
    setCode("");
    setName("");
    setPhone("");
    setAddress("");
    setEmail("");
    setIsActive(true);
    setDialogOpen(true);
  };

  const openEdit = (row: CustomerRow) => {
    setEditing(row);
    setCode(row.customer_code ?? "");
    setName(row.customer_name ?? "");
    setPhone(row.phone ?? "");
    setAddress(row.address ?? "");
    setEmail(row.email ?? "");
    setIsActive(Boolean(row.is_active ?? true));
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const c = code.trim();
      const n = name.trim();
      if (!c || !n) throw new Error("الرجاء إدخال كود واسم العميل");

      if (editing) {
        const { error } = await supabase
          .from("customers")
          .update({
            customer_code: c,
            customer_name: n,
            phone: phone.trim() || null,
            address: address.trim() || null,
            email: email.trim() || null,
            is_active: isActive,
          })
          .eq("id", editing.id);
        if (error) throw error;
        return;
      }

      const { error } = await supabase.from("customers").insert({
        customer_code: c,
        customer_name: n,
        phone: phone.trim() || null,
        address: address.trim() || null,
        email: email.trim() || null,
        is_active: isActive,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success(editing ? "تم تحديث العميل" : "تمت إضافة العميل");
      setDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e: any) => toast.error("تعذر الحفظ: " + (e?.message || "خطأ غير معروف")),
  });

  return (
    <main className="min-h-screen bg-background" dir="rtl">
      <header className="border-b bg-background">
        <div className="mx-auto w-full max-w-6xl px-4 py-6">
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" onClick={() => navigate("/")}
            >
              <ArrowRight className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">سجل الزبائن</h1>
              <p className="mt-1 text-sm text-muted-foreground">إضافة/تعديل الزبائن وإدارتهم.</p>
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
              زبون جديد
            </Button>
          </CardHeader>
          <CardContent>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو الكود أو الهاتف…" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">جاري التحميل…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">لا يوجد زبائن مطابقون.</div>
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
                    {filtered.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.customer_code}</TableCell>
                        <TableCell>{c.customer_name}</TableCell>
                        <TableCell>{c.phone || "—"}</TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{(c.is_active ?? true) ? "نشط" : "موقوف"}</span>
                        </TableCell>
                        <TableCell>
                          <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(c)} title="تعديل">
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
            <DialogTitle>{editing ? "تعديل زبون" : "إضافة زبون"}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">كود الزبون *</label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CUST-001" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">اسم الزبون *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الزبون" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">الهاتف</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">البريد</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="" />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm font-medium mb-1 block">العنوان</label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="" />
            </div>
            <div className="md:col-span-2">
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
