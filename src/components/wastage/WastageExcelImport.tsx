import { useState, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, RotateCcw, Plus, Trash2 } from "lucide-react";
import { getBestItemMatches, normalizeArabic } from "@/lib/fuzzy";
import { ItemPickerDialog, type ItemPickerRow } from "@/components/items/ItemPickerDialog";

type ReasonRow = {
  id: string;
  reason_code: string;
  reason_name: string;
};

type WastageLine = {
  id: string;
  item_id: string;
  quantity: number;
  reason_id: string;
  notes: string;
  source_name?: string;
};

type WastageRecord = {
  id: string;
  wastage_no: string;
  wastage_date: string;
  notes: string;
  lines: WastageLine[];
};

type Props = {
  items: ItemPickerRow[] | undefined;
  reasons: ReasonRow[] | undefined;
};

const LAST_IMPORT_KEY = "wastage_import:last_file:v1";
const MAX_CACHED_BYTES = 4_500_000;

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

export function WastageExcelImport({ items, reasons }: Props) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [records, setRecords] = useState<WastageRecord[]>([]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeLineRef, setActiveLineRef] = useState<{ recordId: string; lineId: string } | null>(null);

  const [lastImport, setLastImport] = useState<{ name: string } | null>(() => {
    try {
      const raw = localStorage.getItem(LAST_IMPORT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return { name: parsed.name };
    } catch {
      return null;
    }
  });

  const itemsIndex = useMemo(() => {
    const byName = new Map<string, string>();
    const byCode = new Map<string, string>();
    for (const it of items ?? []) {
      if (it.item_name) byName.set(normalizeArabic(it.item_name), it.id);
      if (it.item_code) byCode.set(normalizeArabic(it.item_code), it.id);
    }
    return { byName, byCode };
  }, [items]);

  const itemsById = useMemo(() => {
    const map = new Map<string, ItemPickerRow>();
    for (const it of items ?? []) map.set(it.id, it);
    return map;
  }, [items]);

  const cacheFile = (file: File, buf: ArrayBuffer) => {
    try {
      if (buf.byteLength > MAX_CACHED_BYTES) {
        localStorage.removeItem(LAST_IMPORT_KEY);
        setLastImport(null);
        return;
      }
      const payload = { name: file.name, dataBase64: arrayBufferToBase64(buf) };
      localStorage.setItem(LAST_IMPORT_KEY, JSON.stringify(payload));
      setLastImport({ name: file.name });
    } catch {
      setLastImport(null);
    }
  };

  const parseExcel = (buf: ArrayBuffer) => {
    const wb = XLSX.read(buf, { type: "array" });
    const parsed: WastageRecord[] = [];

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
      if (rows.length < 2) continue;

      // Try to find header row
      const headerRowIdx = rows.findIndex((r) =>
        (r ?? []).some((c) => String(c ?? "").includes("الصنف") || String(c ?? "").includes("النوع"))
      );
      if (headerRowIdx === -1) continue;

      const header = rows[headerRowIdx].map((c) => String(c ?? "").trim());
      const findCol = (candidates: string[]) =>
        header.findIndex((h) => candidates.some((cand) => h.includes(cand)));

      const colName = findCol(["الصنف", "النوع", "اسم"]);
      const colQty = findCol(["الكمية", "العدد", "كمية"]);

      if (colName === -1 || colQty === -1) continue;

      const lines: WastageLine[] = [];
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        const nameRaw = String(r?.[colName] ?? "").trim();
        if (!nameRaw) continue;

        const qty = Number(r?.[colQty] ?? 0);
        if (!Number.isFinite(qty) || qty <= 0) continue;

        const key = normalizeArabic(nameRaw);
        const matchedId = itemsIndex.byCode.get(key) ?? itemsIndex.byName.get(key) ?? "";

        lines.push({
          id: crypto.randomUUID(),
          item_id: matchedId,
          quantity: qty,
          reason_id: "",
          notes: "",
          source_name: nameRaw,
        });
      }

      if (lines.length === 0) continue;

      parsed.push({
        id: crypto.randomUUID(),
        wastage_no: `W-${sheetName.replace(/\s+/g, "_")}`,
        wastage_date: new Date().toISOString().split("T")[0],
        notes: "",
        lines,
      });
    }

    return parsed;
  };

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      cacheFile(file, buf);
      const parsed = parseExcel(buf);
      if (parsed.length === 0) {
        toast.error("لم يتم العثور على بيانات صالحة في الملف");
        return;
      }
      setRecords(parsed);
      toast.success(`تم استيراد ${parsed.length} سجل(ات)`);
    } catch (e: any) {
      toast.error("فشل الاستيراد: " + (e.message || "خطأ غير معروف"));
    }
  };

  const handleReimport = async () => {
    try {
      const raw = localStorage.getItem(LAST_IMPORT_KEY);
      if (!raw) {
        toast.info("لا يوجد ملف سابق");
        return;
      }
      const cached = JSON.parse(raw);
      const buf = base64ToArrayBuffer(cached.dataBase64);
      const parsed = parseExcel(buf);
      if (parsed.length === 0) {
        toast.error("لم يتم العثور على بيانات صالحة");
        return;
      }
      setRecords(parsed);
      toast.success(`تم إعادة استيراد ${parsed.length} سجل(ات)`);
    } catch (e: any) {
      toast.error("فشل إعادة الاستيراد: " + (e.message || "خطأ غير معروف"));
    }
  };

  const updateRecord = (recordId: string, patch: Partial<WastageRecord>) => {
    setRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, ...patch } : r)));
  };

  const updateLine = (recordId: string, lineId: string, patch: Partial<WastageLine>) => {
    setRecords((prev) =>
      prev.map((r) =>
        r.id === recordId
          ? { ...r, lines: r.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) }
          : r
      )
    );
  };

  const addLine = (recordId: string) => {
    setRecords((prev) =>
      prev.map((r) =>
        r.id === recordId
          ? {
              ...r,
              lines: [
                ...r.lines,
                { id: crypto.randomUUID(), item_id: "", quantity: 0, reason_id: "", notes: "" },
              ],
            }
          : r
      )
    );
  };

  const removeLine = (recordId: string, lineId: string) => {
    setRecords((prev) =>
      prev.map((r) =>
        r.id === recordId
          ? { ...r, lines: r.lines.filter((l) => l.id !== lineId) }
          : r
      ).filter((r) => r.lines.length > 0)
    );
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (records.length === 0) throw new Error("لا توجد سجلات للحفظ");

      for (const rec of records) {
        if (!rec.wastage_no.trim()) throw new Error("رقم السجل مطلوب");
        if (!rec.wastage_date) throw new Error("التاريخ مطلوب");

        const validLines = rec.lines.filter((l) => l.item_id && l.quantity > 0 && l.reason_id);
        if (validLines.length === 0) {
          throw new Error(`السجل ${rec.wastage_no} لا يحتوي على أصناف صالحة (صنف + كمية + سبب)`);
        }

        const { data: header, error: headerError } = await supabase
          .from("wastage_headers")
          .insert({
            wastage_no: rec.wastage_no.trim(),
            wastage_date: rec.wastage_date,
            notes: rec.notes.trim() || null,
          })
          .select()
          .single();

        if (headerError) throw headerError;

        const { error: linesError } = await supabase.from("wastage_lines").insert(
          validLines.map((l, idx) => ({
            wastage_header_id: header.id,
            line_no: idx + 1,
            item_id: l.item_id,
            quantity: l.quantity,
            reason_id: l.reason_id,
            notes: l.notes.trim() || null,
          }))
        );

        if (linesError) throw linesError;
      }
    },
    onSuccess: () => {
      toast.success("تم حفظ جميع السجلات بنجاح");
      queryClient.invalidateQueries({ queryKey: ["wastages-list"] });
      setRecords([]);
    },
    onError: (e: any) => {
      toast.error("خطأ في الحفظ: " + e.message);
    },
  });

  const openPickerFor = (recordId: string, lineId: string) => {
    setActiveLineRef({ recordId, lineId });
    setPickerOpen(true);
  };

  const totals = {
    records: records.length,
    lines: records.reduce((s, r) => s + r.lines.length, 0),
    qty: records.reduce((s, r) => s + r.lines.reduce((ss, l) => ss + (Number(l.quantity) || 0), 0), 0),
  };

  const hasIncomplete = records.some(
    (r) =>
      !r.wastage_no.trim() ||
      !r.wastage_date ||
      r.lines.some((l) => !l.item_id || !l.reason_id || l.quantity <= 0)
  );

  return (
    <>
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>استيراد من Excel</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 ml-2" />
            اختيار ملف
          </Button>
          {lastImport && (
            <Button variant="ghost" onClick={handleReimport}>
              <RotateCcw className="h-4 w-4 ml-2" />
              إعادة استيراد ({lastImport.name})
            </Button>
          )}
        </CardContent>
      </Card>

      {records.length > 0 && (
        <>
          {records.map((rec) => (
            <Card key={rec.id} className="mb-4">
              <CardHeader>
                <CardTitle className="text-lg">سجل: {rec.wastage_no}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">رقم السجل *</label>
                    <Input
                      value={rec.wastage_no}
                      onChange={(e) => updateRecord(rec.id, { wastage_no: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">التاريخ *</label>
                    <Input
                      type="date"
                      value={rec.wastage_date}
                      onChange={(e) => updateRecord(rec.id, { wastage_date: e.target.value })}
                    />
                  </div>
                </div>

                <div className="border rounded p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">الأصناف</h4>
                    <Button size="sm" variant="outline" onClick={() => addLine(rec.id)}>
                      <Plus className="h-4 w-4 ml-1" />
                      إضافة
                    </Button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-right p-2">م</th>
                          <th className="text-right p-2">الصنف</th>
                          <th className="text-right p-2">الكمية</th>
                          <th className="text-right p-2">السبب</th>
                          <th className="text-right p-2">ملاحظات</th>
                          <th className="p-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rec.lines.map((line, idx) => {
                          const item = itemsById.get(line.item_id);
                          const unmatched = !line.item_id && !!line.source_name;
                          return (
                            <tr key={line.id} className={`border-b ${unmatched ? "bg-yellow-50" : ""}`}>
                              <td className="p-2">{idx + 1}</td>
                              <td className="p-2">
                                <Button
                                  variant="outline"
                                  className={`w-full justify-start text-right truncate ${unmatched ? "border-yellow-400" : ""}`}
                                  onClick={() => openPickerFor(rec.id, line.id)}
                                >
                                  {item
                                    ? `${item.item_code} - ${item.item_name}`
                                    : line.source_name || "اختر صنف..."}
                                </Button>
                              </td>
                              <td className="p-2">
                                <Input
                                  type="number"
                                  min={0}
                                  className="w-20"
                                  value={line.quantity || ""}
                                  onChange={(e) =>
                                    updateLine(rec.id, line.id, { quantity: Number(e.target.value) })
                                  }
                                />
                              </td>
                              <td className="p-2">
                                <Select
                                  value={line.reason_id}
                                  onValueChange={(v) => updateLine(rec.id, line.id, { reason_id: v })}
                                >
                                  <SelectTrigger className="w-36">
                                    <SelectValue placeholder="السبب" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(reasons ?? []).map((r) => (
                                      <SelectItem key={r.id} value={r.id}>
                                        {r.reason_name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="p-2">
                                <Input
                                  className="w-28"
                                  placeholder="ملاحظات"
                                  value={line.notes}
                                  onChange={(e) =>
                                    updateLine(rec.id, line.id, { notes: e.target.value })
                                  }
                                />
                              </td>
                              <td className="p-2">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => removeLine(rec.id, line.id)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">ملاحظات</label>
                  <Textarea
                    rows={2}
                    value={rec.notes}
                    onChange={(e) => updateRecord(rec.id, { notes: e.target.value })}
                  />
                </div>
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardContent className="py-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  {totals.records} سجل | {totals.lines} صنف | إجمالي الكمية: {totals.qty}
                </div>
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending || hasIncomplete}
                >
                  {saveMutation.isPending ? "جاري الحفظ..." : "حفظ جميع السجلات"}
                </Button>
              </div>
              {hasIncomplete && (
                <p className="text-xs text-destructive mt-2">
                  يوجد سجلات أو أسطر ناقصة (صنف / كمية / سبب).
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ItemPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        items={items}
        suggestQuery={
          activeLineRef
            ? records
                .find((r) => r.id === activeLineRef.recordId)
                ?.lines.find((l) => l.id === activeLineRef.lineId)?.source_name
            : undefined
        }
        onPick={(itemId) => {
          if (activeLineRef) {
            updateLine(activeLineRef.recordId, activeLineRef.lineId, { item_id: itemId });
          }
          setPickerOpen(false);
        }}
      />
    </>
  );
}
