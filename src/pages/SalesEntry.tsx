import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface SalesLine {
  id: string;
  item_id: string;
  quantity: number;
  unit_price: number;
}

const SalesEntry = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [invoiceNo, setInvoiceNo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<SalesLine[]>([
    { id: crypto.randomUUID(), item_id: "", quantity: 0, unit_price: 0 }
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
    }
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
    }
  });

  const itemsById = useMemo(() => {
    const map = new Map<string, any>();
    for (const it of items ?? []) map.set(it.id, it);
    return map;
  }, [items]);

  const expectedLineTotal = (line: SalesLine) => {
    const item = itemsById.get(line.item_id);
    const cost = Number(item?.cost_price ?? 0);
    // إجمالي قيمة البيع المتوقعة للكمية = (تكلفة الوحدة × 1.09) × الكمية
    return line.quantity * cost * 1.09;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!invoiceNo || !invoiceDate) {
        throw new Error("الرجاء إدخال رقم الفاتورة والتاريخ");
      }

      const validLines = lines.filter(l => l.item_id && l.quantity > 0 && l.unit_price > 0);
      if (validLines.length === 0) {
        throw new Error("الرجاء إضافة عنصر واحد على الأقل");
      }

      const totalAmount = validLines.reduce((sum, line) => 
        sum + (line.quantity * line.unit_price), 0
      );

      // Insert header
      const { data: header, error: headerError } = await supabase
        .from("sales_headers")
        .insert({
          invoice_no: "S-" + invoiceNo,
          customer_id: customerId || null,
          invoice_date: invoiceDate,
          total_amount: totalAmount,
          payment_method: paymentMethod,
          notes: notes
        })
        .select()
        .single();

      if (headerError) throw headerError;

      // Insert lines
      const { error: linesError } = await supabase
        .from("sales_lines")
        .insert(
          validLines.map((line, idx) => ({
            sales_header_id: header.id,
            line_no: idx + 1,
            item_id: line.item_id,
            quantity: line.quantity,
            unit_price: line.unit_price
          }))
        );

      if (linesError) throw linesError;

      // Register invoice
      await supabase
        .from("invoice_register")
        .insert({
          invoice_no: "S-" + invoiceNo,
          invoice_type: "SALES"
        });
    },
    onSuccess: () => {
      toast.success("تم حفظ فاتورة المبيعات بنجاح");
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      // Reset form
      setInvoiceNo("");
      setCustomerId("");
      setInvoiceDate(new Date().toISOString().split("T")[0]);
      setPaymentMethod("");
      setNotes("");
      setLines([{ id: crypto.randomUUID(), item_id: "", quantity: 0, unit_price: 0 }]);
    },
    onError: (error: any) => {
      toast.error("خطأ في الحفظ: " + error.message);
    }
  });

  const addLine = () => {
    setLines([...lines, { id: crypto.randomUUID(), item_id: "", quantity: 0, unit_price: 0 }]);
  };

  const removeLine = (id: string) => {
    if (lines.length > 1) {
      setLines(lines.filter(l => l.id !== id));
    }
  };

  const updateLine = (id: string, field: keyof SalesLine, value: any) => {
    setLines(lines.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const calculateTotal = () => {
    return lines.reduce((sum, line) => sum + (line.quantity * line.unit_price), 0).toFixed(3);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6" dir="rtl">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" onClick={() => navigate("/")}>
            <ArrowRight className="h-5 w-5" />
          </Button>
          <h1 className="text-3xl font-bold text-slate-900">فاتورة مبيعات جديدة</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>بيانات الفاتورة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">رقم الفاتورة *</label>
                  <div className="flex gap-2">
                    <span className="p-2 bg-slate-100 rounded-md">S-</span>
                    <Input
                      value={invoiceNo}
                      onChange={(e) => setInvoiceNo(e.target.value)}
                      placeholder="000123"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">العميل (اختياري)</label>
                  <select
                    className="w-full p-2 border rounded-md"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                  >
                    <option value="">بيع نقدي</option>
                    {customers?.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.customer_code} - {customer.customer_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">تاريخ الفاتورة *</label>
                  <Input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">طريقة الدفع</label>
                  <Input
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    placeholder="نقد / بطاقة / آجل"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">ملاحظات</label>
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="ملاحظات إضافية"
                  />
                </div>
              </div>

              <hr className="my-6" />

              <h3 className="text-lg font-semibold mb-4">أصناف الفاتورة</h3>

              {lines.map((line, idx) => (
                <div key={line.id} className="grid grid-cols-15 gap-4 items-end mb-4">
                  <div className="col-span-1">
                    <label className="text-sm font-medium mb-1 block">م</label>
                    <div className="p-2 bg-slate-100 rounded-md text-center tabular-nums">
                      {idx + 1}
                    </div>
                  </div>

                  <div className="col-span-5">
                    <label className="text-sm font-medium mb-1 block">العنصر *</label>
                    <select
                      className="w-full p-2 border rounded-md"
                      value={line.item_id}
                      onChange={(e) => updateLine(line.id, "item_id", e.target.value)}
                    >
                      <option value="">اختر العنصر</option>
                      {items?.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.item_code} - {item.item_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="col-span-2">
                    <label className="text-sm font-medium mb-1 block">الكمية *</label>
                    <Input
                      type="number"
                      step="0.001"
                      value={line.quantity || ""}
                      onChange={(e) => updateLine(line.id, "quantity", parseFloat(e.target.value) || 0)}
                      placeholder="0.000"
                    />
                  </div>
                  
                  <div className="col-span-2">
                    <label className="text-sm font-medium mb-1 block">السعر (د.ك) *</label>
                    <Input
                      type="number"
                      step="0.001"
                      value={line.unit_price || ""}
                      onChange={(e) => updateLine(line.id, "unit_price", parseFloat(e.target.value) || 0)}
                      placeholder="0.000"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="text-sm font-medium mb-1 block">المتوقع</label>
                    <div className="p-2 bg-slate-100 rounded-md text-center tabular-nums">
                      {expectedLineTotal(line).toFixed(3)}
                    </div>
                  </div>

                  <div className="col-span-2">
                    <label className="text-sm font-medium mb-1 block">المجموع</label>
                    <div className="p-2 bg-slate-100 rounded-md text-center tabular-nums">
                      {(line.quantity * line.unit_price).toFixed(3)}
                    </div>
                  </div>
                  
                  <div className="col-span-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLine(line.id)}
                      disabled={lines.length === 1}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}

              <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-2 pt-4 border-t">
                <Button onClick={addLine} variant="outline">
                  <Plus className="h-4 w-4 ml-2" />
                  إضافة سطر
                </Button>

                <div className="text-end space-y-1">
                  <div className="text-sm text-muted-foreground">الإجمالي المتوقع: {lines.reduce((sum, l) => sum + expectedLineTotal(l), 0).toFixed(3)} د.ك</div>
                  <div className="text-xl font-bold">الإجمالي: {calculateTotal()} د.ك</div>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-4">
                <Button variant="outline" onClick={() => navigate("/")}>
                  إلغاء
                </Button>
                <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "جاري الحفظ..." : "حفظ الفاتورة"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SalesEntry;