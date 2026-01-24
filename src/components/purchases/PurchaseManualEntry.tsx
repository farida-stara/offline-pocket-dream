import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { isInvoiceDuplicate } from "@/hooks/useInvoiceDuplicateCheck";
import { ItemPickerDialog } from "@/components/items/ItemPickerDialog";

type ItemRow = { id: string; item_code?: string | null; item_name?: string | null; cost_price?: number | null };

type PurchaseLine = {
  id: string;
  item_id: string;
  quantity_paid: number;
  quantity_free: number;
  unit_price: number;
  /** Manual margin multiplier (e.g. 1.25) stored in purchase_lines.margin_factor */
  margin_factor?: number;
};

export function PurchaseManualEntry(props: {
  items: ItemRow[] | undefined;
  suppliers: Array<{ id: string; supplier_code?: string | null; supplier_name?: string | null }> | undefined;
}) {
  const { items, suppliers } = props;
  const queryClient = useQueryClient();

  const [invoiceNo, setInvoiceNo] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  type PaymentMethod = "cash" | "credit" | "knet" | "bank_transfer" | "other";
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentMethodOther, setPaymentMethodOther] = useState("");
  const [notes, setNotes] = useState("");

  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [newSupplierCode, setNewSupplierCode] = useState("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");

  const [lines, setLines] = useState<PurchaseLine[]>([
    { id: crypto.randomUUID(), item_id: "", quantity_paid: 0, quantity_free: 0, unit_price: 0, margin_factor: undefined },
  ]);

  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);

  const itemsById = useMemo(() => {
    const map = new Map<string, any>();
    for (const it of items ?? []) map.set(it.id, it);
    return map;
  }, [items]);

  const actualInvoiceTotal = () => {
    return lines.reduce((sum, line) => sum + line.quantity_paid * line.unit_price, 0);
  };

  const expectedSellingTotal = () => {
    return lines.reduce((sum, line) => {
      const totalQty = Number(line.quantity_paid ?? 0) + Number(line.quantity_free ?? 0);
      const margin = Number(line.margin_factor);
      const usedMargin = Number.isFinite(margin) && margin > 0 ? margin : 1;
      const expectedSell = Number(line.unit_price ?? 0) * usedMargin;
      return sum + expectedSell * totalQty;
    }, 0);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!invoiceNo || !supplierId || !invoiceDate) {
        throw new Error("الرجاء إدخال جميع البيانات المطلوبة");
      }

       const validLines = lines.filter(
         (l) =>
           l.item_id &&
           ((Number(l.quantity_paid) > 0 && Number(l.unit_price) > 0) || (Number(l.quantity_free) > 0 && Number(l.unit_price) === 0)),
       );
      if (validLines.length === 0) {
        throw new Error("الرجاء إضافة عنصر واحد على الأقل");
      }

       const totalAmount = validLines.reduce((sum, line) => sum + Number(line.quantity_paid) * Number(line.unit_price), 0);

      const normalizedInvoiceNo = /^[a-zA-Z]+-/.test(invoiceNo.trim()) ? invoiceNo.trim() : `P-${invoiceNo.trim()}`;

      // Check for duplicate
      const isDuplicate = await isInvoiceDuplicate(normalizedInvoiceNo, "PURCHASE");
      if (isDuplicate) {
        throw new Error(`رقم الفاتورة "${normalizedInvoiceNo}" موجود مسبقاً`);
      }

       // Keep payment_method aligned with Payment Ledger methods.
       // If user selects "other", we store "other" here.
       const finalPaymentMethod = paymentMethod;

      const { data: header, error: headerError } = await supabase
        .from("purchase_headers")
        .insert({
          invoice_no: normalizedInvoiceNo,
          supplier_id: supplierId,
          invoice_date: invoiceDate,
          total_amount: totalAmount,
          payment_method: finalPaymentMethod || null,
          notes:
            paymentMethod === "other" && paymentMethodOther.trim()
              ? `${notes ? `${notes}\n` : ""}طريقة الدفع (أخرى): ${paymentMethodOther.trim()}`
              : notes,
        })
        .select()
        .single();

      if (headerError) throw headerError;

      const { error: linesError } = await supabase.from("purchase_lines").insert(
        validLines.map((line, idx) => ({
          purchase_header_id: header.id,
          line_no: idx + 1,
          item_id: line.item_id,
          quantity_paid: line.quantity_paid,
          quantity_free: line.quantity_free,
          unit_price: line.unit_price,
          margin_factor:
            Number.isFinite(Number(line.margin_factor)) && Number(line.margin_factor) > 0 ? Number(line.margin_factor) : 1,
        })),
      );

      if (linesError) throw linesError;

      await supabase.from("invoice_register").insert({
        invoice_no: normalizedInvoiceNo,
        invoice_type: "PURCHASE",
      });

    },
    onSuccess: () => {
      toast.success("تم حفظ فاتورة المشتريات بنجاح");
      queryClient.invalidateQueries({ queryKey: ["purchases"] });

      setInvoiceNo("");
      setSupplierId("");
      setInvoiceDate(new Date().toISOString().split("T")[0]);
      setPaymentMethod("cash");
      setPaymentMethodOther("");
      setNotes("");
      setLines([{ id: crypto.randomUUID(), item_id: "", quantity_paid: 0, quantity_free: 0, unit_price: 0, margin_factor: undefined }]);
    },
    onError: (error: any) => {
      toast.error("خطأ في الحفظ: " + error.message);
    },
  });

  const addLine = () => {
    setLines([...lines, { id: crypto.randomUUID(), item_id: "", quantity_paid: 0, quantity_free: 0, unit_price: 0, margin_factor: undefined }]);
  };

  const removeLine = (id: string) => {
    setLines(lines.filter((l) => l.id !== id));
  };

  const updateLine = (id: string, field: keyof PurchaseLine, value: any) => {
    setLines(lines.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  };

  const createSupplierMutation = useMutation({
    mutationFn: async () => {
      const code = newSupplierCode.trim();
      const name = newSupplierName.trim();
      if (!code || !name) throw new Error("الرجاء إدخال كود واسم المورد");

      const { data, error } = await supabase
        .from("suppliers")
        .insert({
          supplier_code: code,
          supplier_name: name,
          phone: newSupplierPhone.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("تمت إضافة المورد");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setSupplierDialogOpen(false);
      setNewSupplierCode("");
      setNewSupplierName("");
      setNewSupplierPhone("");
      if (data?.id) setSupplierId(data.id);
    },
    onError: (e: any) => toast.error("تعذر إضافة المورد: " + (e?.message || "خطأ غير معروف")),
  });

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>فاتورة مشتريات (يدوي)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6" dir="rtl">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">رقم الفاتورة *</label>
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="P-000123 أو 000123" />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">المورد *</label>
              <div className="flex gap-2">
                <select className="w-full p-2 border rounded-md" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">اختر المورد</option>
                  {suppliers?.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.supplier_code} - {supplier.supplier_name}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" onClick={() => setSupplierDialogOpen(true)}>
                  إضافة
                </Button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">تاريخ الفاتورة *</label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>

            <div className="md:col-span-1" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">طريقة الدفع</label>
              <div className="space-y-2">
                <select
                  className="w-full p-2 border rounded-md"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                >
                  <option value="cash">كاش</option>
                  <option value="credit">أجل</option>
                  <option value="knet">كي نت</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                  <option value="other">أخرى…</option>
                </select>
                {paymentMethod === "other" && (
                  <Input value={paymentMethodOther} onChange={(e) => setPaymentMethodOther(e.target.value)} placeholder="اكتب طريقة الدفع" />
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">ملاحظات</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات إضافية" />
            </div>
          </div>

          <hr className="my-6" />

          <h3 className="text-lg font-semibold mb-4">أصناف الفاتورة</h3>

          {lines.map((line, idx) => {
            const margin = Number(line.margin_factor);
            const usedMargin = Number.isFinite(margin) && margin > 0 ? margin : 1;
            const expectedSell = Number(line.unit_price ?? 0) * usedMargin;
            const totalQty = Number(line.quantity_paid ?? 0) + Number(line.quantity_free ?? 0);
            const expectedSellTotal = expectedSell * totalQty;
            const costPrice = Number(itemsById.get(line.item_id)?.cost_price ?? 0);
            void costPrice;

            return (
              <div key={line.id} className="grid grid-cols-16 gap-4 items-end mb-4">
                <div className="col-span-1">
                  <label className="text-sm font-medium mb-1 block">م</label>
                  <div className="p-2 bg-muted rounded-md text-center tabular-nums">{idx + 1}</div>
                </div>

                 <div className="col-span-3">
                  <label className="text-sm font-medium mb-1 block">العنصر *</label>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between"
                    onClick={() => {
                      setActiveLineId(line.id);
                      setItemPickerOpen(true);
                    }}
                  >
                    <span className="truncate">
                      {line.item_id
                        ? (() => {
                            const it = itemsById.get(line.item_id);
                            return it?.item_code ? `${it.item_code} - ${it.item_name}` : it?.item_name || "";
                          })()
                        : "اختر الصنف (بحث بالكود/الاسم)"}
                    </span>
                    <span className="text-xs text-muted-foreground">بحث</span>
                  </Button>
                </div>

                <div className="col-span-2">
                  <label className="text-sm font-medium mb-1 block">الكمية المدفوعة *</label>
                  <Input type="number" step="0.001" value={line.quantity_paid || ""} onChange={(e) => updateLine(line.id, "quantity_paid", parseFloat(e.target.value) || 0)} />
                </div>

                <div className="col-span-2">
                  <label className="text-sm font-medium mb-1 block">الكمية المجانية</label>
                  <Input type="number" step="0.001" value={line.quantity_free || ""} onChange={(e) => updateLine(line.id, "quantity_free", parseFloat(e.target.value) || 0)} />
                </div>

                <div className="col-span-2">
                  <label className="text-sm font-medium mb-1 block">سعر الشراء *</label>
                  <Input type="number" step="0.001" value={line.unit_price || ""} onChange={(e) => updateLine(line.id, "unit_price", parseFloat(e.target.value) || 0)} />
                </div>

                <div className="col-span-2">
                  <label className="text-sm font-medium mb-1 block">سعر بيع متوقع</label>
                  <div className="p-2 bg-muted rounded-md text-center tabular-nums">{expectedSell.toFixed(3)}</div>
                </div>

                <div className="col-span-2">
                  <label className="text-sm font-medium mb-1 block">هامش (مضاعف)</label>
                  <Input
                    type="number"
                    step="0.001"
                    value={Number.isFinite(Number(line.margin_factor)) ? String(line.margin_factor) : ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      updateLine(line.id, "margin_factor", raw.trim() === "" ? undefined : parseFloat(raw) || 0);
                    }}
                    placeholder="1.000"
                    title="مثال: 1.25 يعني ربح 25% تقريباً."
                  />
                </div>

                 <div className="col-span-1">
                  <label className="text-sm font-medium mb-1 block">إجمالي البيع المتوقع</label>
                  <div className="p-2 bg-muted rounded-md text-center tabular-nums">{expectedSellTotal.toFixed(3)}</div>
                </div>

                <div className="col-span-1">
                  <Button variant="ghost" size="icon" onClick={() => removeLine(line.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}

          <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-2 pt-4 border-t">
            <Button onClick={addLine} variant="outline">
              <Plus className="h-4 w-4 ml-2" />
              إضافة سطر
            </Button>

            <div className="text-end space-y-1">
              <div className="text-sm text-muted-foreground">عدد السطور: {lines.length}</div>
              <div className="text-sm text-muted-foreground">إجمالي البيع المتوقع: {expectedSellingTotal().toFixed(3)} د.ك</div>
              <div className="text-xl font-bold">الإجمالي: {actualInvoiceTotal().toFixed(3)} د.ك</div>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "جاري الحفظ..." : "حفظ الفاتورة"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <Dialog open={supplierDialogOpen} onOpenChange={setSupplierDialogOpen}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>إضافة مورد جديد</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium mb-1 block">كود المورد *</label>
            <Input value={newSupplierCode} onChange={(e) => setNewSupplierCode(e.target.value)} placeholder="SUP-001" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">اسم المورد *</label>
            <Input value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} placeholder="اسم المورد" />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm font-medium mb-1 block">الهاتف</label>
            <Input value={newSupplierPhone} onChange={(e) => setNewSupplierPhone(e.target.value)} placeholder="" />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setSupplierDialogOpen(false)}>
            إلغاء
          </Button>
          <Button type="button" onClick={() => createSupplierMutation.mutate()} disabled={createSupplierMutation.isPending}>
            {createSupplierMutation.isPending ? "جاري الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ItemPickerDialog
      open={itemPickerOpen}
      onOpenChange={(open) => {
        setItemPickerOpen(open);
        if (!open) setActiveLineId(null);
      }}
      items={items}
      suggestQuery={
        activeLineId
          ? (() => {
              const l = lines.find((x) => x.id === activeLineId);
              return l?.item_id ? (itemsById.get(l.item_id)?.item_name ?? "") : "";
            })()
          : ""
      }
      onPick={(itemId) => {
        if (!activeLineId) return;
        updateLine(activeLineId, "item_id", itemId);
      }}
    />
    </>
  );
}
