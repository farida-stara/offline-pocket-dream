import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, Check, AlertCircle, Edit2, Trash2, Save } from "lucide-react";
import * as XLSX from "xlsx";
import { parseSalesExcel, SalesExcelInvoice, normalizeSalesInvoiceNo } from "@/lib/salesExcel";
import { fuzzyMatch } from "@/lib/fuzzy";

interface MatchedLine {
  itemCode: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  matchedItemId: string | null;
  matchedItemName: string;
}

interface PreviewInvoice extends Omit<SalesExcelInvoice, "lines"> {
  lines: MatchedLine[];
  matchedCustomerId: string | null;
  editing: boolean;
}

const SalesExcelImport = () => {
  const queryClient = useQueryClient();
  const [previews, setPreviews] = useState<PreviewInvoice[]>([]);
  const [importing, setImporting] = useState(false);

  const { data: items } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items_master")
        .select("*")
        .eq("is_active", true);
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
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const itemsMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const it of items ?? []) {
      map.set(it.item_code.toLowerCase(), it);
      map.set(it.item_name.toLowerCase(), it);
    }
    return map;
  }, [items]);

  const customersMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const c of customers ?? []) {
      map.set(c.customer_code.toLowerCase(), c);
      map.set(c.customer_name.toLowerCase(), c);
    }
    return map;
  }, [customers]);

  const matchItem = useCallback(
    (code: string, name: string): { id: string | null; name: string } => {
      const byCode = itemsMap.get(code.toLowerCase());
      if (byCode) return { id: byCode.id, name: byCode.item_name };
      const byName = itemsMap.get(name.toLowerCase());
      if (byName) return { id: byName.id, name: byName.item_name };
      // Fuzzy
      for (const it of items ?? []) {
        if (fuzzyMatch(code, it.item_code) || fuzzyMatch(name, it.item_name)) {
          return { id: it.id, name: it.item_name };
        }
      }
      return { id: null, name: "" };
    },
    [items, itemsMap]
  );

  const matchCustomer = useCallback(
    (code: string, name: string): string | null => {
      const byCode = customersMap.get(code.toLowerCase());
      if (byCode) return byCode.id;
      const byName = customersMap.get(name.toLowerCase());
      if (byName) return byName.id;
      for (const c of customers ?? []) {
        if (fuzzyMatch(code, c.customer_code) || fuzzyMatch(name, c.customer_name)) {
          return c.id;
        }
      }
      return null;
    },
    [customers, customersMap]
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    const parsed = parseSalesExcel(workbook);

    const mapped: PreviewInvoice[] = parsed.map((inv) => {
      const matchedLines: MatchedLine[] = inv.lines.map((line) => {
        const match = matchItem(line.itemCode, line.itemName);
        return {
          ...line,
          matchedItemId: match.id,
          matchedItemName: match.name,
        };
      });
      return {
        ...inv,
        lines: matchedLines,
        matchedCustomerId: matchCustomer(inv.customerCode, inv.customerName),
        editing: false,
      };
    });

    setPreviews(mapped);
    e.target.value = "";
    toast.success(`تم تحميل ${mapped.length} فاتورة من الملف`);
  };

  const updateInvoiceField = (idx: number, field: keyof PreviewInvoice, value: any) => {
    setPreviews((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p))
    );
  };

  const updateLineField = (
    invIdx: number,
    lineIdx: number,
    field: keyof MatchedLine,
    value: any
  ) => {
    setPreviews((prev) =>
      prev.map((p, i) =>
        i === invIdx
          ? {
              ...p,
              lines: p.lines.map((l, li) =>
                li === lineIdx ? { ...l, [field]: value } : l
              ),
            }
          : p
      )
    );
  };

  const removeInvoice = (idx: number) => {
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const removeLine = (invIdx: number, lineIdx: number) => {
    setPreviews((prev) =>
      prev.map((p, i) =>
        i === invIdx
          ? { ...p, lines: p.lines.filter((_, li) => li !== lineIdx) }
          : p
      )
    );
  };

  const saveAllMutation = useMutation({
    mutationFn: async () => {
      const toSave = previews.filter(
        (p) => p.lines.length > 0 && p.lines.every((l) => l.matchedItemId)
      );

      if (toSave.length === 0) {
        throw new Error("لا توجد فواتير جاهزة للحفظ (تأكد من مطابقة جميع الأصناف)");
      }

      for (const inv of toSave) {
        const invoiceNo = normalizeSalesInvoiceNo(inv.invoiceNo);
        const totalAmount = inv.lines.reduce(
          (sum, l) => sum + l.quantity * l.unitPrice,
          0
        );

        const { data: header, error: headerError } = await supabase
          .from("sales_headers")
          .insert({
            invoice_no: invoiceNo,
            customer_id: inv.matchedCustomerId,
            invoice_date: inv.invoiceDate,
            total_amount: totalAmount,
            payment_method: inv.paymentMethod,
            notes: inv.notes,
          })
          .select()
          .single();

        if (headerError) throw headerError;

        const { error: linesError } = await supabase.from("sales_lines").insert(
          inv.lines.map((line, idx) => ({
            sales_header_id: header.id,
            line_no: idx + 1,
            item_id: line.matchedItemId!,
            quantity: line.quantity,
            unit_price: line.unitPrice,
            line_total: line.quantity * line.unitPrice,
          }))
        );

        if (linesError) throw linesError;

        await supabase.from("invoice_register").insert({
          invoice_no: invoiceNo,
          invoice_type: "SALES",
        });
      }

      return toSave.length;
    },
    onSuccess: (count) => {
      toast.success(`تم حفظ ${count} فاتورة مبيعات بنجاح`);
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      setPreviews([]);
    },
    onError: (error: any) => {
      toast.error("خطأ: " + error.message);
    },
  });

  const readyCount = previews.filter(
    (p) => p.lines.length > 0 && p.lines.every((l) => l.matchedItemId)
  ).length;

  return (
    <div className="space-y-6">
      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            استيراد فواتير المبيعات من Excel
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              className="max-w-xs"
            />
            <span className="text-sm text-muted-foreground">
              كل شيت = فاتورة مبيعات منفصلة
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Previews */}
      {previews.length > 0 && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">
              معاينة الفواتير ({previews.length})
            </h2>
            <Button
              onClick={() => saveAllMutation.mutate()}
              disabled={saveAllMutation.isPending || readyCount === 0}
            >
              <Save className="h-4 w-4 ml-2" />
              {saveAllMutation.isPending
                ? "جاري الحفظ..."
                : `حفظ ${readyCount} فاتورة`}
            </Button>
          </div>

          {previews.map((inv, invIdx) => {
            const hasUnmatched = inv.lines.some((l) => !l.matchedItemId);
            const lineCount = inv.lines.length;
            const grandTotal = inv.lines
              .reduce((sum, l) => sum + l.quantity * l.unitPrice, 0)
              .toFixed(3);

            return (
              <Card
                key={invIdx}
                className={hasUnmatched ? "border-amber-400" : "border-green-400"}
              >
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      {hasUnmatched ? (
                        <AlertCircle className="h-5 w-5 text-amber-500" />
                      ) : (
                        <Check className="h-5 w-5 text-green-500" />
                      )}
                      <CardTitle className="text-lg">
                        {inv.sheetName} — {normalizeSalesInvoiceNo(inv.invoiceNo)}
                      </CardTitle>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          updateInvoiceField(invIdx, "editing", !inv.editing)
                        }
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeInvoice(invIdx)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {inv.editing ? (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                      <div>
                        <label className="text-sm font-medium">رقم الفاتورة</label>
                        <Input
                          value={inv.invoiceNo}
                          onChange={(e) =>
                            updateInvoiceField(invIdx, "invoiceNo", e.target.value)
                          }
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">التاريخ</label>
                        <Input
                          type="date"
                          value={inv.invoiceDate}
                          onChange={(e) =>
                            updateInvoiceField(invIdx, "invoiceDate", e.target.value)
                          }
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">العميل</label>
                        <select
                          className="w-full p-2 border rounded-md"
                          value={inv.matchedCustomerId ?? ""}
                          onChange={(e) =>
                            updateInvoiceField(
                              invIdx,
                              "matchedCustomerId",
                              e.target.value || null
                            )
                          }
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
                        <label className="text-sm font-medium">طريقة الدفع</label>
                        <Input
                          value={inv.paymentMethod}
                          onChange={(e) =>
                            updateInvoiceField(invIdx, "paymentMethod", e.target.value)
                          }
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground mb-2">
                      {inv.invoiceDate} |{" "}
                      {inv.matchedCustomerId
                        ? customers?.find((c) => c.id === inv.matchedCustomerId)
                            ?.customer_name ?? "عميل"
                        : "بيع نقدي"}{" "}
                      | {inv.paymentMethod}
                    </div>
                  )}

                  {/* Lines table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="p-2 text-start">م</th>
                          <th className="p-2 text-start">الكود</th>
                          <th className="p-2 text-start">الصنف (Excel)</th>
                          <th className="p-2 text-start">مطابق</th>
                          <th className="p-2 text-end">الكمية</th>
                          <th className="p-2 text-end">السعر</th>
                          <th className="p-2 text-end">الإجمالي</th>
                          <th className="p-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.lines.map((line, lineIdx) => (
                          <tr
                            key={lineIdx}
                            className={
                              line.matchedItemId ? "" : "bg-amber-50"
                            }
                          >
                            <td className="p-2">{lineIdx + 1}</td>
                            <td className="p-2">{line.itemCode}</td>
                            <td className="p-2">{line.itemName}</td>
                            <td className="p-2">
                              {inv.editing || !line.matchedItemId ? (
                                <select
                                  className="w-full p-1 border rounded text-sm"
                                  value={line.matchedItemId ?? ""}
                                  onChange={(e) =>
                                    updateLineField(
                                      invIdx,
                                      lineIdx,
                                      "matchedItemId",
                                      e.target.value || null
                                    )
                                  }
                                >
                                  <option value="">اختر الصنف</option>
                                  {items?.map((it) => (
                                    <option key={it.id} value={it.id}>
                                      {it.item_code} - {it.item_name}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-green-700">
                                  {line.matchedItemName}
                                </span>
                              )}
                            </td>
                            <td className="p-2 text-end tabular-nums">
                              {inv.editing ? (
                                <Input
                                  type="number"
                                  step="0.001"
                                  className="w-20 text-end"
                                  value={line.quantity}
                                  onChange={(e) =>
                                    updateLineField(
                                      invIdx,
                                      lineIdx,
                                      "quantity",
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                />
                              ) : (
                                line.quantity.toFixed(3)
                              )}
                            </td>
                            <td className="p-2 text-end tabular-nums">
                              {inv.editing ? (
                                <Input
                                  type="number"
                                  step="0.001"
                                  className="w-24 text-end"
                                  value={line.unitPrice}
                                  onChange={(e) =>
                                    updateLineField(
                                      invIdx,
                                      lineIdx,
                                      "unitPrice",
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                />
                              ) : (
                                line.unitPrice.toFixed(3)
                              )}
                            </td>
                            <td className="p-2 text-end tabular-nums">
                              {(line.quantity * line.unitPrice).toFixed(3)}
                            </td>
                            <td className="p-2">
                              {inv.editing && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeLine(invIdx, lineIdx)}
                                >
                                  <Trash2 className="h-4 w-4 text-red-500" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary */}
                  <div className="flex justify-between items-center mt-4 pt-2 border-t">
                    <span className="text-sm text-muted-foreground">
                      عدد الأصناف: {lineCount}
                    </span>
                    <span className="font-bold">الإجمالي: {grandTotal} د.ك</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SalesExcelImport;
