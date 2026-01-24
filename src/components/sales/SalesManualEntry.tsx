import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { isInvoiceDuplicate } from "@/hooks/useInvoiceDuplicateCheck";
import { Checkbox } from "@/components/ui/checkbox";
import { useNavigate } from "react-router-dom";
import { useSalesStockPricing } from "@/hooks/useSalesStockPricing";
import { StockBalanceBreakdownDialog } from "@/components/sales/StockBalanceBreakdownDialog";

interface SalesLine {
  id: string;
  item_id: string;
  quantity: number;
  unit_price: number;
  /** Optional manual margin override (multiplier, e.g. 1.25). If unset, we use last purchase margin. */
  margin_factor?: number;
}

const SalesManualEntry = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [invoiceNo, setInvoiceNo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "knet" | "credit" | "bank_transfer" | "visa" | "other"
  >("cash");
  const [paymentMethodOther, setPaymentMethodOther] = useState("");
  const [notes, setNotes] = useState("");

  const [salesRepId, setSalesRepId] = useState<string>("");
  const [repCollects, setRepCollects] = useState(false);

  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [newCustomerCode, setNewCustomerCode] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");

  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownItemId, setBreakdownItemId] = useState<string | null>(null);
  const [lines, setLines] = useState<SalesLine[]>([
    { id: crypto.randomUUID(), item_id: "", quantity: 0, unit_price: 0, margin_factor: undefined },
  ]);

  const { data: items } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items_master")
        .select("*")
        .eq("is_active", true)
        .order("item_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("is_active", true)
        .order("customer_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: salesReps } = useQuery({
    queryKey: ["sales-reps"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_reps")
        .select("id, rep_name")
        .eq("is_active", true)
        .order("rep_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const itemsById = useMemo(() => {
    const map = new Map<string, any>();
    for (const it of items ?? []) map.set(it.id, it);
    return map;
  }, [items]);

  const itemIdsForInvoice = useMemo(() => lines.map((l) => l.item_id).filter(Boolean), [lines]);
  const { data: stockPricingMap } = useSalesStockPricing({
    itemIds: itemIdsForInvoice,
    invoiceDate,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!invoiceNo || !invoiceDate) {
        throw new Error("الرجاء إدخال رقم الفاتورة والتاريخ");
      }

      const validLines = lines.filter(
        (l) => l.item_id && l.quantity > 0 && l.unit_price > 0
      );
      if (validLines.length === 0) {
        throw new Error("الرجاء إضافة صنف واحد على الأقل");
      }

      const totalAmount = validLines.reduce(
        (sum, line) => sum + line.quantity * line.unit_price,
        0
      );

      const normalizedNo = invoiceNo.toUpperCase().startsWith("S-")
        ? invoiceNo
        : `S-${invoiceNo}`;

      // Check for duplicate
      const isDuplicate = await isInvoiceDuplicate(normalizedNo, "SALES");
      if (isDuplicate) {
        throw new Error(`رقم الفاتورة "${normalizedNo}" موجود مسبقاً`);
      }

      const finalPaymentMethod =
        paymentMethod === "other" ? paymentMethodOther.trim() : paymentMethod;
      const safePaymentMethod = finalPaymentMethod || "cash";

      const { data: header, error: headerError } = await supabase
        .from("sales_headers")
        .insert({
          invoice_no: normalizedNo,
          customer_id: customerId || null,
          invoice_date: invoiceDate,
          total_amount: totalAmount,
            payment_method: safePaymentMethod,
          notes: notes,
          sales_rep_id: salesRepId || null,
          rep_collects: repCollects,
        })
        .select()
        .single();

      if (headerError) throw headerError;

      const { error: linesError } = await supabase.from("sales_lines").insert(
        validLines.map((line, idx) => ({
          sales_header_id: header.id,
          line_no: idx + 1,
          item_id: line.item_id,
          quantity: line.quantity,
          unit_price: line.unit_price,
        }))
      );

      if (linesError) throw linesError;

      const { error: regError } = await supabase.from("invoice_register").insert({
        invoice_no: normalizedNo,
        invoice_type: "SALES",
      });

      // IMPORTANT: invoice_register enforces the real uniqueness.
      // If it fails (e.g. duplicate), rollback the header/lines so we don't keep a "ghost" invoice.
      if (regError) {
        await supabase.from("sales_lines").delete().eq("sales_header_id", header.id);
        await supabase.from("sales_headers").delete().eq("id", header.id);
        throw regError;
      }
    },
    onSuccess: () => {
      toast.success("تم حفظ فاتورة المبيعات بنجاح");
      queryClient.invalidateQueries({ queryKey: ["sales-list"] });
      resetForm();
      navigate("/sales");
    },
    onError: (error: any) => {
      toast.error("خطأ في الحفظ: " + error.message);
    },
  });

  const resetForm = () => {
    setInvoiceNo("");
    setCustomerId("");
    setInvoiceDate(new Date().toISOString().split("T")[0]);
    setPaymentMethod("cash");
    setPaymentMethodOther("");
    setNotes("");
    setSalesRepId("");
    setRepCollects(false);
    setLines([{ id: crypto.randomUUID(), item_id: "", quantity: 0, unit_price: 0, margin_factor: undefined }]);
  };

  const createCustomerMutation = useMutation({
    mutationFn: async () => {
      const code = newCustomerCode.trim();
      const name = newCustomerName.trim();
      if (!code || !name) throw new Error("الرجاء إدخال كود واسم العميل");

      const { data, error } = await supabase
        .from("customers")
        .insert({
          customer_code: code,
          customer_name: name,
          phone: newCustomerPhone.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("تمت إضافة العميل");
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setCustomerDialogOpen(false);
      setNewCustomerCode("");
      setNewCustomerName("");
      setNewCustomerPhone("");
      if (data?.id) setCustomerId(data.id);
    },
    onError: (e: any) => toast.error("تعذر إضافة العميل: " + (e?.message || "خطأ غير معروف")),
  });

  const addLine = () => {
    setLines([
      ...lines,
      { id: crypto.randomUUID(), item_id: "", quantity: 0, unit_price: 0, margin_factor: undefined },
    ]);
  };

  const removeLine = (id: string) => {
    if (lines.length > 1) {
      setLines(lines.filter((l) => l.id !== id));
    }
  };

  const updateLine = (id: string, field: keyof SalesLine, value: any) => {
    setLines(lines.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  };

  const calculateTotal = () => {
    return lines
      .reduce((sum, line) => sum + line.quantity * line.unit_price, 0)
      .toFixed(3);
  };

  const expectedSellingTotal = useMemo(() => {
    return lines.reduce((sum, line) => {
      if (!line.item_id) return sum;
      const sp = stockPricingMap?.[line.item_id];
      const purchaseUnit = Number(sp?.lastPurchaseUnitPrice ?? 0);
      const purchaseMarginMultiplier = Number(sp?.lastPurchaseMarginFactor ?? NaN);
      const manualMarginPct = Number(line.margin_factor);
      const usedMarginMultiplier = Number.isFinite(manualMarginPct)
        ? 1 + manualMarginPct / 100
        : Number.isFinite(purchaseMarginMultiplier)
          ? purchaseMarginMultiplier
          : 1.09;
      const expectedUnit = purchaseUnit * usedMarginMultiplier;
      const qty = Number(line.quantity ?? 0);
      if (!Number.isFinite(qty) || !Number.isFinite(expectedUnit)) return sum;
      return sum + qty * expectedUnit;
    }, 0);
  }, [lines, stockPricingMap]);

  const expectedDiff = useMemo(() => {
    const actual = Number(calculateTotal());
    return Number(expectedSellingTotal) - actual;
  }, [expectedSellingTotal, lines]);

  const lineCount = lines.filter((l) => l.item_id && l.quantity > 0).length;

  return (
    <>
    <StockBalanceBreakdownDialog
      open={breakdownOpen}
      onOpenChange={setBreakdownOpen}
      itemId={breakdownItemId}
      invoiceDate={invoiceDate}
    />

    <Card>
      <CardHeader>
        <CardTitle>إدخال فاتورة مبيعات يدوياً</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Header */}
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">
                رقم الفاتورة *
              </label>
              <div className="flex gap-2">
                <span className="p-2 bg-muted rounded-md">S-</span>
                <Input
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="000123"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">العميل</label>
              <div className="flex gap-2">
                <select
                  className="w-full p-2 border rounded-md"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">مجهول</option>
                  {customers?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.customer_code} - {c.customer_name}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" onClick={() => setCustomerDialogOpen(true)}>
                  إضافة
                </Button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">
                تاريخ الفاتورة *
              </label>
              <Input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">
                طريقة الدفع
              </label>
              <div className="space-y-2">
                <select
                  className="w-full p-2 border rounded-md"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                >
                  <option value="cash">نقد</option>
                  <option value="knet">كي نت</option>
                  <option value="visa">فيزا</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                  <option value="credit">آجل</option>
                  <option value="other">أخرى…</option>
                </select>
                {paymentMethod === "other" && (
                  <Input value={paymentMethodOther} onChange={(e) => setPaymentMethodOther(e.target.value)} placeholder="اكتب طريقة الدفع" />
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">مندوب المبيعات</label>
              <select
                className="w-full p-2 border rounded-md"
                value={salesRepId}
                onChange={(e) => setSalesRepId(e.target.value)}
              >
                <option value="">بدون</option>
                {(salesReps ?? []).map((r: any) => (
                  <option key={r.id} value={r.id}>
                    {r.rep_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-2">
              <Checkbox id="rep_collects" checked={repCollects} onCheckedChange={(v) => setRepCollects(Boolean(v))} />
              <label htmlFor="rep_collects" className="text-sm font-medium">
                المندوب مسؤول عن التحصيل
              </label>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">ملاحظات</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات إضافية"
            />
          </div>

          <hr />

          <h3 className="text-lg font-semibold">أصناف الفاتورة</h3>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2 text-start w-12">م</th>
                  <th className="p-2 text-start">الصنف *</th>
                  <th className="p-2 text-end w-28">الكمية *</th>
                  <th className="p-2 text-end w-28">السعر *</th>
                  <th className="p-2 text-end w-28">الإجمالي</th>
                  <th className="p-2 text-end border-s-2 border-amber-400 bg-amber-50">رصيد المخزن</th>
                  <th className="p-2 text-end bg-amber-50">سعر الوحدة-شراء</th>
                  <th className="p-2 text-end bg-amber-50">هامش %</th>
                  <th className="p-2 text-end bg-amber-50">سعر البيع المتوقع للوحدة</th>
                  <th className="p-2 text-end bg-amber-50">إجمالي سعر البيع المتوقع</th>
                  <th className="p-2 text-end border-e-2 border-amber-400 bg-amber-50">فرق البيع عن المتوقع</th>
                  <th className="p-2 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  (() => {
                    const sp = line.item_id ? stockPricingMap?.[line.item_id] : undefined;
                    const stockBalance = Number(sp?.stockBalance ?? 0);
                    const purchaseUnit = Number(sp?.lastPurchaseUnitPrice ?? 0);
                    const purchaseMarginMultiplier = Number(sp?.lastPurchaseMarginFactor ?? NaN);
                    const purchaseMarginPct = Number.isFinite(purchaseMarginMultiplier)
                      ? (purchaseMarginMultiplier - 1) * 100
                      : NaN;
                    const manualMarginPct = Number(line.margin_factor);
                    const usedMarginMultiplier = Number.isFinite(manualMarginPct)
                      ? 1 + manualMarginPct / 100
                      : Number.isFinite(purchaseMarginMultiplier)
                        ? purchaseMarginMultiplier
                        : 1.09;
                    const expectedUnit = purchaseUnit * usedMarginMultiplier;
                    const actualLineTotal = Number(line.quantity * line.unit_price);
                    const expectedTotal = Number(line.quantity || 0) * expectedUnit;
                    const diff = expectedTotal - actualLineTotal;
                    const stockWarn = Number(line.quantity || 0) > stockBalance;
                    const diffWarn = diff < 0;
                    const purchaseHeaderId = sp?.lastPurchaseHeaderId ?? null;
                    const purchaseInvoiceNo = sp?.lastPurchaseInvoiceNo ?? null;

                    return (
                  <tr key={line.id} className="border-b">
                    <td className="p-2">{idx + 1}</td>
                    <td className="p-2">
                      <select
                        className="w-full p-2 border rounded-md"
                        value={line.item_id}
                        onChange={(e) =>
                          updateLine(line.id, "item_id", e.target.value)
                        }
                      >
                        <option value="">اختر الصنف</option>
                        {items?.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.item_code} - {item.item_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        step="0.001"
                        className="text-end"
                        value={line.quantity || ""}
                        onChange={(e) =>
                          updateLine(
                            line.id,
                            "quantity",
                            parseFloat(e.target.value) || 0
                          )
                        }
                        placeholder="0.000"
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        step="0.001"
                        className="text-end"
                        value={line.unit_price || ""}
                        onChange={(e) =>
                          updateLine(
                            line.id,
                            "unit_price",
                            parseFloat(e.target.value) || 0
                          )
                        }
                        placeholder="0.000"
                      />
                    </td>
                    <td className="p-2 text-end tabular-nums">
                      {(line.quantity * line.unit_price).toFixed(3)}
                    </td>

                     <td
                       className={
                         "p-2 text-end tabular-nums border-s-2 border-amber-400 bg-amber-50 " +
                         (stockWarn ? "ring-1 ring-amber-400" : "")
                       }
                       title="الرصيد = افتتاحي + مشتريات - مبيعات - توالف (ضمن الفترة)"
                     >
                       <button
                         type="button"
                         className="underline underline-offset-4"
                         title="عرض مصدر حساب رصيد المخزن"
                         onClick={() => {
                           setBreakdownItemId(line.item_id);
                           setBreakdownOpen(true);
                         }}
                       >
                         {stockBalance.toFixed(3)}
                       </button>
                     </td>

                    <td className="p-2 text-end tabular-nums bg-amber-50">
                      {purchaseHeaderId ? (
                        <button
                          type="button"
                          className="underline underline-offset-4"
                          title={`فتح آخر فاتورة شراء: ${purchaseInvoiceNo ?? ""}`}
                          onClick={() => navigate(`/purchases/${purchaseHeaderId}`)}
                        >
                          {purchaseUnit.toFixed(3)}
                        </button>
                      ) : (
                        purchaseUnit.toFixed(3)
                      )}
                    </td>

                    <td className="p-2 text-end tabular-nums bg-amber-50">
                      <Input
                        type="number"
                        step="0.001"
                        className="text-end"
                        value={Number.isFinite(Number(line.margin_factor)) ? String(line.margin_factor) : ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          updateLine(
                            line.id,
                            "margin_factor",
                            raw.trim() === "" ? undefined : parseFloat(raw) || 0
                          );
                        }}
                        placeholder={Number.isFinite(purchaseMarginPct) ? purchaseMarginPct.toFixed(3) : "9.000"}
                        title="هامش الربح المتوقع (%). اتركه فارغاً لاستخدام هامش آخر فاتورة شراء، وإن لم يوجد فسيتم استخدام 9%."
                      />
                    </td>
                    <td className="p-2 text-end tabular-nums bg-amber-50">{expectedUnit.toFixed(3)}</td>
                    <td className="p-2 text-end tabular-nums bg-amber-50">{expectedTotal.toFixed(3)}</td>
                    <td
                      className={
                        "p-2 text-end tabular-nums border-e-2 border-amber-400 bg-amber-50 " +
                        (diffWarn ? "text-destructive font-semibold" : "")
                      }
                    >
                      {diff.toFixed(3)}
                    </td>

                    <td className="p-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(line.id)}
                        disabled={lines.length === 1}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </td>
                  </tr>
                    );
                  })()
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 pt-4 border-t">
            <Button onClick={addLine} variant="outline">
              <Plus className="h-4 w-4 ml-2" />
              إضافة سطر
            </Button>

            <div className="text-end space-y-1">
              <div className="text-sm text-muted-foreground">
                عدد الأصناف: {lineCount}
              </div>
              <div className="text-xl font-bold">الإجمالي: {calculateTotal()} د.ك</div>
              <div className="text-sm text-muted-foreground">
                إجمالي سعر البيع المتوقع: {expectedSellingTotal.toFixed(3)} د.ك
              </div>
              <div className="text-sm text-muted-foreground">
                الفرق (المتوقع - الإجمالي): {expectedDiff.toFixed(3)} د.ك
              </div>
              {notes.trim() && (
                <div className="text-sm pt-2 border-t">
                  <span className="font-semibold">ملاحظة: </span>
                  <span>{notes}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button variant="outline" onClick={resetForm}>
              مسح الكل
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "جاري الحفظ..." : "حفظ الفاتورة"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <Dialog open={customerDialogOpen} onOpenChange={setCustomerDialogOpen}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>إضافة عميل جديد</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium mb-1 block">كود العميل *</label>
            <Input value={newCustomerCode} onChange={(e) => setNewCustomerCode(e.target.value)} placeholder="CUST-001" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">اسم العميل *</label>
            <Input value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} placeholder="اسم العميل" />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm font-medium mb-1 block">الهاتف</label>
            <Input value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setCustomerDialogOpen(false)}>
            إلغاء
          </Button>
          <Button type="button" onClick={() => createCustomerMutation.mutate()} disabled={createCustomerMutation.isPending}>
            {createCustomerMutation.isPending ? "جاري الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};

export default SalesManualEntry;
