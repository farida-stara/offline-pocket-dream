import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

type ItemRow = { id: string; item_code?: string | null; item_name?: string | null; cost_price?: number | null };

type PurchaseLine = {
  id: string;
  item_id: string;
  quantity_paid: number;
  quantity_free: number;
  unit_price: number;
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
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [marginPercent, setMarginPercent] = useState<number>(0);

  const [lines, setLines] = useState<PurchaseLine[]>([
    { id: crypto.randomUUID(), item_id: "", quantity_paid: 0, quantity_free: 0, unit_price: 0 },
  ]);

  const itemsById = useMemo(() => {
    const map = new Map<string, any>();
    for (const it of items ?? []) map.set(it.id, it);
    return map;
  }, [items]);

  const actualInvoiceTotal = () => {
    return lines.reduce((sum, line) => sum + line.quantity_paid * line.unit_price, 0);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!invoiceNo || !supplierId || !invoiceDate) {
        throw new Error("الرجاء إدخال جميع البيانات المطلوبة");
      }

      const validLines = lines.filter((l) => l.item_id && l.quantity_paid > 0 && l.unit_price > 0);
      if (validLines.length === 0) {
        throw new Error("الرجاء إضافة عنصر واحد على الأقل");
      }

      const totalAmount = validLines.reduce((sum, line) => sum + line.quantity_paid * line.unit_price, 0);

      const normalizedInvoiceNo = /^[a-zA-Z]+-/.test(invoiceNo.trim()) ? invoiceNo.trim() : `P-${invoiceNo.trim()}`;

      const { data: header, error: headerError } = await supabase
        .from("purchase_headers")
        .insert({
          invoice_no: normalizedInvoiceNo,
          supplier_id: supplierId,
          invoice_date: invoiceDate,
          total_amount: totalAmount,
          payment_method: paymentMethod,
          notes,
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
        })),
      );

      if (linesError) throw linesError;

      await supabase.from("invoice_register").insert({
        invoice_no: normalizedInvoiceNo,
        invoice_type: "PURCHASE",
      });

      // Margin is currently preview-only (no DB column). We keep it on screen for calculations.
      void marginPercent;
    },
    onSuccess: () => {
      toast.success("تم حفظ فاتورة المشتريات بنجاح");
      queryClient.invalidateQueries({ queryKey: ["purchases"] });

      setInvoiceNo("");
      setSupplierId("");
      setInvoiceDate(new Date().toISOString().split("T")[0]);
      setPaymentMethod("cash");
      setNotes("");
      setMarginPercent(0);
      setLines([{ id: crypto.randomUUID(), item_id: "", quantity_paid: 0, quantity_free: 0, unit_price: 0 }]);
    },
    onError: (error: any) => {
      toast.error("خطأ في الحفظ: " + error.message);
    },
  });

  const addLine = () => {
    setLines([...lines, { id: crypto.randomUUID(), item_id: "", quantity_paid: 0, quantity_free: 0, unit_price: 0 }]);
  };

  const removeLine = (id: string) => {
    if (lines.length > 1) setLines(lines.filter((l) => l.id !== id));
  };

  const updateLine = (id: string, field: keyof PurchaseLine, value: any) => {
    setLines(lines.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  };

  return (
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
              <select className="w-full p-2 border rounded-md" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">اختر المورد</option>
                {suppliers?.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.supplier_code} - {supplier.supplier_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">تاريخ الفاتورة *</label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">هامش % (للعرض)</label>
              <Input type="number" step="0.01" value={marginPercent} onChange={(e) => setMarginPercent(Number(e.target.value || 0))} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">طريقة الدفع</label>
              <Input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="cash" />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">ملاحظات</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات إضافية" />
            </div>
          </div>

          <hr className="my-6" />

          <h3 className="text-lg font-semibold mb-4">أصناف الفاتورة</h3>

          {lines.map((line, idx) => {
            const expectedSell = Number(line.unit_price ?? 0) * (1 + marginPercent / 100);
            const costPrice = Number(itemsById.get(line.item_id)?.cost_price ?? 0);
            void costPrice;

            return (
              <div key={line.id} className="grid grid-cols-14 gap-4 items-end mb-4">
                <div className="col-span-1">
                  <label className="text-sm font-medium mb-1 block">م</label>
                  <div className="p-2 bg-muted rounded-md text-center tabular-nums">{idx + 1}</div>
                </div>

                <div className="col-span-4">
                  <label className="text-sm font-medium mb-1 block">العنصر *</label>
                  <select className="w-full p-2 border rounded-md" value={line.item_id} onChange={(e) => updateLine(line.id, "item_id", e.target.value)}>
                    <option value="">اختر العنصر</option>
                    {items?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.item_code} - {item.item_name}
                      </option>
                    ))}
                  </select>
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

                <div className="col-span-1">
                  <Button variant="ghost" size="icon" onClick={() => removeLine(line.id)} disabled={lines.length === 1}>
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
  );
}
