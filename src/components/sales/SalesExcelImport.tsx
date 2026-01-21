import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, Check, AlertCircle, Edit2, Trash2, Save, RotateCcw, Plus } from "lucide-react";
import * as XLSX from "xlsx";
import { parseSalesExcel, SalesExcelInvoice, normalizeSalesInvoiceNo } from "@/lib/salesExcel";
import { fuzzyMatch } from "@/lib/fuzzy";
import { checkDuplicateInvoices } from "@/hooks/useInvoiceDuplicateCheck";
import { getDisplayQuantities, mergeNotesWithQuantities } from "@/lib/salesLineQuantities";

const LAST_IMPORT_STORAGE_KEY = "sales_invoices:last_import:v1";
const MAX_CACHED_FILE_BYTES = 4_500_000;

type LastImportCache = {
  name: string;
  lastModified: number;
  dataBase64: string;
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

interface MatchedLine {
  itemCode: string;
  itemName: string;
  quantity: number;
  notes?: string;
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  
  const [lastImport, setLastImport] = useState<Pick<LastImportCache, "name" | "lastModified"> | null>(() => {
    try {
      const raw = localStorage.getItem(LAST_IMPORT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as LastImportCache;
      return { name: parsed.name, lastModified: parsed.lastModified };
    } catch {
      return null;
    }
  });

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

  const triggerFilePick = () => fileInputRef.current?.click();

  const cacheLastImport = (file: File, buf: ArrayBuffer) => {
    try {
      if (buf.byteLength > MAX_CACHED_FILE_BYTES) {
        setLastImport(null);
        localStorage.removeItem(LAST_IMPORT_STORAGE_KEY);
        return;
      }
      const payload: LastImportCache = {
        name: file.name,
        lastModified: file.lastModified,
        dataBase64: arrayBufferToBase64(buf),
      };
      localStorage.setItem(LAST_IMPORT_STORAGE_KEY, JSON.stringify(payload));
      setLastImport({ name: payload.name, lastModified: payload.lastModified });
    } catch {
      setLastImport(null);
    }
  };

  const importFromArrayBuffer = (buf: ArrayBuffer) => {
    const workbook = XLSX.read(buf, { type: "array" });
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
    
    if (mapped.length > 0) {
      toast.success(`تم تحميل ${mapped.length} فاتورة من الملف`);
    } else {
      toast.error("لم يتم العثور على فواتير صالحة داخل الملف");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buf = await file.arrayBuffer();
      cacheLastImport(file, buf);
      importFromArrayBuffer(buf);
    } catch (err: any) {
      toast.error("فشل الاستيراد: " + (err?.message || "خطأ غير معروف"));
    }
    e.target.value = "";
  };

  const handleReimportLastFile = async () => {
    try {
      const raw = localStorage.getItem(LAST_IMPORT_STORAGE_KEY);
      if (!raw) {
        toast.info("لا يوجد ملف سابق محفوظ للاستيراد");
        return;
      }
      const cached = JSON.parse(raw) as LastImportCache;
      const buf = base64ToArrayBuffer(cached.dataBase64);
      importFromArrayBuffer(buf);
    } catch (err: any) {
      toast.error("تعذر استيراد الملف الأخير: " + (err?.message || "خطأ غير معروف"));
    }
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

  const addLine = (invIdx: number) => {
    const nextLine: MatchedLine = {
      itemCode: "",
      itemName: "",
      quantity: 0,
      unitPrice: 0,
      lineTotal: 0,
      matchedItemId: null,
      matchedItemName: "",
    };

    setPreviews((prev) =>
      prev.map((p, i) => (i === invIdx ? { ...p, lines: [...p.lines, nextLine] } : p))
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

      // Check for duplicates
      const invoiceNumbers = toSave.map((inv) => normalizeSalesInvoiceNo(inv.invoiceNo));
      const duplicates = await checkDuplicateInvoices(invoiceNumbers, "SALES");
      if (duplicates.length > 0) {
        throw new Error(`تحذير: أرقام الفواتير التالية موجودة مسبقاً: ${duplicates.join(", ")}`);
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
            notes: line.notes ?? null,
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
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileUpload}
            />
            
            <Button type="button" variant="outline" onClick={triggerFilePick}>
              <Upload className="h-4 w-4 ml-2" />
              استيراد من Excel
            </Button>
            
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleReimportLastFile()}
              disabled={!lastImport}
              title={lastImport ? `آخر ملف: ${lastImport.name}` : "لا يوجد ملف سابق محفوظ"}
            >
              <RotateCcw className="h-4 w-4 ml-2" />
              استيراد الملف الأخير
            </Button>
            
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
                          <th className="p-2 text-end">الكمية المباعه</th>
                          <th className="p-2 text-end">مرتجع لعدم البيع</th>
                          <th className="p-2 text-end">الكمية المسحوبة</th>
                          <th className="p-2 text-end">السعر</th>
                          <th className="p-2 text-end">الإجمالي</th>
                          <th className="p-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.lines.map((line, lineIdx) => (
                          (() => {
                            const q = getDisplayQuantities({ quantity: line.quantity, notes: line.notes ?? null });
                            const returned = q.returned;
                            const withdrawn = q.withdrawn;

                            const updateQtyMeta = (next: { returned?: number; withdrawn?: number }) => {
                              const merged = mergeNotesWithQuantities(line.notes ?? null, {
                                sold: line.quantity,
                                returned: next.returned ?? returned,
                                withdrawn: next.withdrawn ?? withdrawn,
                              });
                              updateLineField(invIdx, lineIdx, "notes", merged ?? "");
                            };

                            return (
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
                                  className="w-20 text-end"
                                  value={returned}
                                  onChange={(e) => updateQtyMeta({ returned: parseFloat(e.target.value) || 0 })}
                                />
                              ) : (
                                Number(returned || 0).toFixed(3)
                              )}
                            </td>

                            <td className="p-2 text-end tabular-nums">
                              {inv.editing ? (
                                <Input
                                  type="number"
                                  step="0.001"
                                  className="w-20 text-end"
                                  value={withdrawn}
                                  onChange={(e) => updateQtyMeta({ withdrawn: parseFloat(e.target.value) || 0 })}
                                />
                              ) : (
                                Number(withdrawn || 0).toFixed(3)
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
                                  disabled={inv.lines.length <= 1}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              )}
                            </td>
                          </tr>
                            );
                          })()
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {inv.editing && (
                    <div className="mt-3">
                      <Button type="button" variant="outline" onClick={() => addLine(invIdx)}>
                        <Plus className="h-4 w-4 ml-2" />
                        إضافة سطر
                      </Button>
                    </div>
                  )}

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
