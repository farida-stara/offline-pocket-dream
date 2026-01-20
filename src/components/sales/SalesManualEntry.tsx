import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

interface SalesLine {
  id: string;
  item_id: string;
  quantity: number;
  unit_price: number;
}

const SalesManualEntry = () => {
  const queryClient = useQueryClient();
  const [invoiceNo, setInvoiceNo] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [paymentMethod, setPaymentMethod] = useState("نقد");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<SalesLine[]>([
    { id: crypto.randomUUID(), item_id: "", quantity: 0, unit_price: 0 },
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

  const itemsById = useMemo(() => {
    const map = new Map<string, any>();
    for (const it of items ?? []) map.set(it.id, it);
    return map;
  }, [items]);

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

      const { data: header, error: headerError } = await supabase
        .from("sales_headers")
        .insert({
          invoice_no: normalizedNo,
          customer_id: customerId || null,
          invoice_date: invoiceDate,
          total_amount: totalAmount,
          payment_method: paymentMethod,
          notes: notes,
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
          line_total: line.quantity * line.unit_price,
        }))
      );

      if (linesError) throw linesError;

      await supabase.from("invoice_register").insert({
        invoice_no: normalizedNo,
        invoice_type: "SALES",
      });
    },
    onSuccess: () => {
      toast.success("تم حفظ فاتورة المبيعات بنجاح");
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      resetForm();
    },
    onError: (error: any) => {
      toast.error("خطأ في الحفظ: " + error.message);
    },
  });

  const resetForm = () => {
    setInvoiceNo("");
    setCustomerId("");
    setInvoiceDate(new Date().toISOString().split("T")[0]);
    setPaymentMethod("نقد");
    setNotes("");
    setLines([{ id: crypto.randomUUID(), item_id: "", quantity: 0, unit_price: 0 }]);
  };

  const addLine = () => {
    setLines([
      ...lines,
      { id: crypto.randomUUID(), item_id: "", quantity: 0, unit_price: 0 },
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

  const lineCount = lines.filter((l) => l.item_id && l.quantity > 0).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>إدخال فاتورة مبيعات يدوياً</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Header */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
              <select
                className="w-full p-2 border rounded-md"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">بيع نقدي</option>
                {customers?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.customer_code} - {c.customer_name}
                  </option>
                ))}
              </select>
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
              <Input
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                placeholder="نقد / بطاقة / آجل"
              />
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
                  <th className="p-2 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
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
  );
};

export default SalesManualEntry;
