import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRight, Plus, Trash2 } from "lucide-react";

type InvoiceType = "SALE" | "PURCHASE";
type PaymentMethod = "cash" | "credit" | "knet" | "bank_transfer" | "other";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "كاش",
  credit: "أجل",
  knet: "كي نت",
  bank_transfer: "تحويل بنكي",
  other: "أخرى",
};

function toNumber(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function PaymentsLedger() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [invoiceTypeFilter, setInvoiceTypeFilter] = useState<InvoiceType | "all">("all");
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | "all">("all");

  const [openAdd, setOpenAdd] = useState(false);

  // Add form state
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("PURCHASE");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [partyId, setPartyId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState<string>(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [otherMethodName, setOtherMethodName] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [bankDetails, setBankDetails] = useState("");
  const [notes, setNotes] = useState("");

  const partyType = invoiceType === "PURCHASE" ? "supplier" : "customer";

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, supplier_name")
        .eq("is_active", true)
        .order("supplier_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, customer_name")
        .eq("is_active", true)
        .order("customer_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const partyOptions = useMemo(() => {
    if (partyType === "supplier") {
      return (suppliers ?? []).map((s) => ({ id: s.id, name: s.supplier_name ?? "-" }));
    }
    return (customers ?? []).map((c) => ({ id: c.id, name: c.customer_name ?? "-" }));
  }, [customers, suppliers, partyType]);

  const { data: payments, isLoading } = useQuery({
    queryKey: ["payment-ledger", dateFrom, dateTo, invoiceTypeFilter, methodFilter],
    queryFn: async () => {
      let q = supabase
        .from("payment_ledger")
        .select("*")
        .order("paid_at", { ascending: false })
        .limit(200);

      if (dateFrom) q = q.gte("paid_at", `${dateFrom}T00:00:00`);
      if (dateTo) q = q.lte("paid_at", `${dateTo}T23:59:59`);
      if (invoiceTypeFilter !== "all") q = q.eq("invoice_type", invoiceTypeFilter);
      if (methodFilter !== "all") q = q.eq("payment_method", methodFilter);

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const amt = toNumber(amount);
      if (amt <= 0) throw new Error("أدخل مبلغ صحيح");
      if (!partyId) throw new Error(invoiceType === "PURCHASE" ? "اختر المورد" : "اختر الزبون");

      const method: PaymentMethod = paymentMethod;
      if (method === "other" && !otherMethodName.trim()) throw new Error("اكتب اسم طريقة الدفع الأخرى");

      const { error } = await supabase.from("payment_ledger").insert({
        invoice_type: invoiceType,
        invoice_no: invoiceNo.trim() || null,
        party_type: partyType,
        party_id: partyId,
        amount: amt,
        payment_method: method,
        other_method_name: method === "other" ? otherMethodName.trim() : null,
        paid_at: new Date(paidAt).toISOString(),
        reference_no: referenceNo.trim() || null,
        bank_details: bankDetails.trim() || null,
        notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم تسجيل الدفعة");
      setOpenAdd(false);
      setInvoiceNo("");
      setAmount("");
      setReferenceNo("");
      setBankDetails("");
      setNotes("");
      setOtherMethodName("");
      await queryClient.invalidateQueries({ queryKey: ["payment-ledger"] });
    },
    onError: (e: any) => toast.error(e?.message || "تعذر تسجيل الدفعة"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payment_ledger").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم حذف الدفعة");
      await queryClient.invalidateQueries({ queryKey: ["payment-ledger"] });
    },
    onError: (e: any) => toast.error(e?.message || "تعذر حذف الدفعة"),
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted p-6" dir="rtl">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate("/")}
              aria-label="العودة للوحة التحكم">
              <ArrowRight className="h-5 w-5" />
            </Button>
            <h1 className="text-3xl font-bold text-foreground">سجل الدفع</h1>
          </div>

          <Dialog open={openAdd} onOpenChange={setOpenAdd}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 ml-2" />
                إضافة دفعة
              </Button>
            </DialogTrigger>
            <DialogContent dir="rtl" className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>إضافة دفعة</DialogTitle>
                <DialogDescription>
                  يمكنك تسجيل دفعات جزئية لنفس الفاتورة لاحقًا بإضافة دفعة أخرى بنفس رقم الفاتورة.
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>نوع الفاتورة</Label>
                  <Select
                    value={invoiceType}
                    onValueChange={(v) => {
                      const next = v as InvoiceType;
                      setInvoiceType(next);
                      setPartyId("");
                    }}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="اختر" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PURCHASE">مشتريات</SelectItem>
                      <SelectItem value="SALE">مبيعات</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>رقم الفاتورة (اختياري)</Label>
                  <Input className="mt-1" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
                </div>

                <div>
                  <Label>{partyType === "supplier" ? "المورد" : "الزبون"}</Label>
                  <Select value={partyId} onValueChange={setPartyId}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="اختر" />
                    </SelectTrigger>
                    <SelectContent>
                      {partyOptions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>المبلغ</Label>
                  <Input className="mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>

                <div>
                  <Label>تاريخ/وقت الدفع</Label>
                  <Input className="mt-1" type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
                </div>

                <div>
                  <Label>طريقة الدفع</Label>
                  <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="اختر" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">كاش</SelectItem>
                      <SelectItem value="credit">أجل</SelectItem>
                      <SelectItem value="knet">كي نت</SelectItem>
                      <SelectItem value="bank_transfer">تحويل بنكي</SelectItem>
                      <SelectItem value="other">أخرى</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {paymentMethod === "other" ? (
                  <div className="md:col-span-2">
                    <Label>اسم طريقة الدفع الأخرى</Label>
                    <Input className="mt-1" value={otherMethodName} onChange={(e) => setOtherMethodName(e.target.value)} />
                  </div>
                ) : null}

                <div>
                  <Label>رقم مرجع (اختياري)</Label>
                  <Input className="mt-1" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
                </div>

                <div>
                  <Label>تفاصيل البنك (اختياري)</Label>
                  <Input className="mt-1" value={bankDetails} onChange={(e) => setBankDetails(e.target.value)} />
                </div>

                <div className="md:col-span-2">
                  <Label>ملاحظات</Label>
                  <Textarea className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setOpenAdd(false)}>
                  إلغاء
                </Button>
                <Button type="button" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
                  {addMutation.isPending ? "جاري الحفظ..." : "حفظ"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">فلترة السجل</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label>من تاريخ</Label>
                <Input className="mt-1" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <Label>إلى تاريخ</Label>
                <Input className="mt-1" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              <div>
                <Label>نوع الفاتورة</Label>
                <Select value={invoiceTypeFilter} onValueChange={(v) => setInvoiceTypeFilter(v as any)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="الكل" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="PURCHASE">مشتريات</SelectItem>
                    <SelectItem value="SALE">مبيعات</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>طريقة الدفع</Label>
                <Select value={methodFilter} onValueChange={(v) => setMethodFilter(v as any)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="الكل" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="cash">كاش</SelectItem>
                    <SelectItem value="credit">أجل</SelectItem>
                    <SelectItem value="knet">كي نت</SelectItem>
                    <SelectItem value="bank_transfer">تحويل بنكي</SelectItem>
                    <SelectItem value="other">أخرى</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="md:col-span-4">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                    setInvoiceTypeFilter("all");
                    setMethodFilter("all");
                  }}
                >
                  مسح الفلاتر
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>
            ) : !payments?.length ? (
              <div className="p-8 text-center text-muted-foreground">لا توجد دفعات</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">التاريخ</TableHead>
                      <TableHead className="text-right">النوع</TableHead>
                      <TableHead className="text-right">رقم الفاتورة</TableHead>
                      <TableHead className="text-right">طريقة الدفع</TableHead>
                      <TableHead className="text-left">المبلغ</TableHead>
                      <TableHead className="text-right">مرجع</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          {p.paid_at ? format(new Date(p.paid_at), "yyyy-MM-dd HH:mm") : "-"}
                        </TableCell>
                        <TableCell>
                          {p.invoice_type === "PURCHASE" ? "مشتريات" : "مبيعات"}
                        </TableCell>
                        <TableCell className="font-medium">{p.invoice_no || "-"}</TableCell>
                        <TableCell>
                          {p.payment_method === "other"
                            ? `أخرى: ${p.other_method_name || "-"}`
                            : METHOD_LABEL[(p.payment_method as PaymentMethod) || "cash"]}
                        </TableCell>
                        <TableCell className="text-left tabular-nums">
                          {Number(p.amount || 0).toFixed(3)} د.ك
                        </TableCell>
                        <TableCell>{p.reference_no || "-"}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="حذف"
                            onClick={() => deleteMutation.mutate(p.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
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
      </div>
    </div>
  );
}
