import { useMemo, useRef, useState, type MouseEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { ArrowRight, Plus, Trash2, Upload, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { getBestItemMatches, normalizeArabic } from "@/lib/fuzzy";

interface OpeningStockLine {
  id: string;
  item_id: string;
  quantity: number;
  unit_cost: number;
  /** اسم الصنف القادم من ملف الاستيراد (للمطابقة فقط) */
  source_name?: string;
}

type LastImportCache = {
  name: string;
  type: string;
  lastModified: number;
  dataBase64: string;
};

const LAST_IMPORT_STORAGE_KEY = "opening_stock:last_import:v1";
const MAX_CACHED_FILE_BYTES = 4_500_000; // ~4.5MB to avoid localStorage quota issues

// تاريخ الرصيد الافتتاحي المعتمد في النظام
const OPENING_STOCK_ENTRY_DATE = "2025-01-18";

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

const OpeningStock = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [lines, setLines] = useState<OpeningStockLine[]>([
    { id: crypto.randomUUID(), item_id: "", quantity: 0, unit_cost: 0 }
  ]);

  const [matcherOpen, setMatcherOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activePickLineId, setActivePickLineId] = useState<string | null>(null);

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

  const itemsIndex = useMemo(() => {
    const byName = new Map<string, string>();
    const byCode = new Map<string, string>();

    (items ?? []).forEach((it: any) => {
      if (it?.item_name) byName.set(normalizeArabic(it.item_name), it.id);
      if (it?.item_code) byCode.set(normalizeArabic(it.item_code), it.id);
    });

    return { byName, byCode };
  }, [items]);

  const unmatchedLines = useMemo(
    () => lines.filter((l) => !l.item_id && !!l.source_name),
    [lines]
  );

  const itemsById = useMemo(() => {
    const map = new Map<string, any>();
    for (const it of items ?? []) map.set(it.id, it);
    return map;
  }, [items]);

  const totals = useMemo(() => {
    const actual = lines.reduce((sum, l) => sum + Number(l.quantity ?? 0) * Number(l.unit_cost ?? 0), 0);
    // الإجمالي المتوقع: قيمة المخزون بسعر البيع من دليل الأصناف (selling_price)
    const expected = lines.reduce((sum, l) => {
      if (!l.item_id) return sum;
      const sp = Number(itemsById.get(l.item_id)?.selling_price ?? 0);
      return sum + Number(l.quantity ?? 0) * sp;
    }, 0);

    return { actual, expected };
  }, [lines, itemsById]);

  const openPickerForLine = (lineId: string) => {
    setActivePickLineId(lineId);
    setPickerOpen(true);
  };

  const applyItemToLine = (lineId: string, itemId: string) => {
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, item_id: itemId } : l)));
  };

  const triggerFilePick = () => fileInputRef.current?.click();

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

  const cacheLastImport = (file: File, buf: ArrayBuffer) => {
    try {
      if (buf.byteLength > MAX_CACHED_FILE_BYTES) {
        // لا نوقف الاستيراد، فقط لا نخزن الملف
        setLastImport(null);
        localStorage.removeItem(LAST_IMPORT_STORAGE_KEY);
        return;
      }

      const payload: LastImportCache = {
        name: file.name,
        type: file.type || "application/octet-stream",
        lastModified: file.lastModified,
        dataBase64: arrayBufferToBase64(buf),
      };

      localStorage.setItem(LAST_IMPORT_STORAGE_KEY, JSON.stringify(payload));
      setLastImport({ name: payload.name, lastModified: payload.lastModified });
    } catch {
      // تجاهل أخطاء التخزين (Quota, إلخ)
      setLastImport(null);
    }
  };

  const importFromArrayBuffer = async (buf: ArrayBuffer) => {
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error("لا يوجد ورقة عمل داخل الملف");

    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: true });

    const headerRowIndex = rows.findIndex((r: any[]) =>
      (r ?? []).some((c) => String(c ?? "").includes("النوع"))
    );
    if (headerRowIndex === -1) {
      throw new Error("لم أتمكن من العثور على صف العناوين (مثل: النوع/العدد/السعر)");
    }

    const header = Array.from(rows[headerRowIndex] ?? [], (c) => String(c ?? "").trim());
    const findCol = (candidates: string[]) =>
      header.findIndex((h) => candidates.some((cand) => String(h ?? "").includes(cand))); 

    const colName = findCol(["النوع", "الصنف", "اسم"]);
    const colQty = findCol(["العدد", "الكمية", "كمية"]);
    const colPrice = findCol(["السعر", "التكلفة", "سعر"]);

    if (colName === -1 || colQty === -1 || colPrice === -1) {
      throw new Error("الأعمدة المطلوبة غير مكتملة. نحتاج: النوع + العدد + السعر");
    }

    const dataRows = rows.slice(headerRowIndex + 1);

    const imported: OpeningStockLine[] = [];
    const unmatched: string[] = [];

    for (const r of dataRows) {
      const nameRaw = String(r?.[colName] ?? "").trim();
      if (!nameRaw) continue;

      const qty = Number(r?.[colQty] ?? 0);
      const unitCost = Number(r?.[colPrice] ?? 0);
      if (!Number.isFinite(qty) || !Number.isFinite(unitCost)) continue;
      if (qty <= 0 || unitCost <= 0) continue;

      const key = normalizeArabic(nameRaw);
      const itemId = itemsIndex.byName.get(key);

      if (!itemId) {
        unmatched.push(nameRaw);
        imported.push({
          id: crypto.randomUUID(),
          item_id: "",
          quantity: qty,
          unit_cost: unitCost,
          source_name: nameRaw,
        });
        continue;
      }

      imported.push({
        id: crypto.randomUUID(),
        item_id: itemId,
        quantity: qty,
        unit_cost: unitCost,
        source_name: nameRaw,
      });
    }

    if (imported.length === 0) {
      toast.error("لم يتم العثور على أي صفوف صالحة للاستيراد");
      return;
    }

    setLines(imported);

    if (unmatched.length) {
      setMatcherOpen(true);
      toast.warning(`تم الاستيراد مع عناصر غير مطابقة (${unmatched.length}). افتح شاشة المطابقة لاختيار الأصناف بسرعة.`);
    } else {
      setMatcherOpen(false);
      toast.success("تم استيراد الملف بنجاح. راجع البيانات ثم اضغط حفظ.");
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      cacheLastImport(file, buf);
      await importFromArrayBuffer(buf);
    } catch (e: any) {
      toast.error("فشل الاستيراد: " + (e?.message || "خطأ غير معروف"));
    }
  };

  const handleReimportLastFile = async () => {
    try {
      const raw = localStorage.getItem(LAST_IMPORT_STORAGE_KEY);
      if (!raw) {
        toast.info("لا يوجد ملف محفوظ للاستيراد. استخدم زر استيراد من Excel أولاً.");
        return;
      }

      const cached = JSON.parse(raw) as LastImportCache;
      const buf = base64ToArrayBuffer(cached.dataBase64);
      await importFromArrayBuffer(buf);
    } catch (e: any) {
      toast.error("تعذر استيراد الملف الأخير: " + (e?.message || "خطأ غير معروف"));
    }
  };

  const { data: existingStock } = useQuery({
    queryKey: ["opening-stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opening_stock")
        .select(`
          *,
          items_master(item_code, item_name, category, selling_price)
        `);
      if (error) throw error;
      return data;
    }
  });

  const existingTotals = useMemo(() => {
    const actual = (existingStock ?? []).reduce((sum: number, s: any) => {
      const v = Number(s?.total_value ?? 0);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);

    const expected = (existingStock ?? []).reduce((sum: number, s: any) => {
      const qty = Number(s?.quantity ?? 0);
      const sp = Number(s?.items_master?.selling_price ?? 0);
      if (!Number.isFinite(qty) || !Number.isFinite(sp)) return sum;
      return sum + qty * sp;
    }, 0);

    return { actual, expected };
  }, [existingStock]);

  const saveMutation = useMutation({
    mutationFn: async (lines: OpeningStockLine[]) => {
      // 1) Auto-create missing items (those imported from Excel but not matched)
      const missingNames = Array.from(
        new Set(
          lines
            .filter((l) => !l.item_id && !!l.source_name)
            .map((l) => String(l.source_name ?? "").trim())
            .filter(Boolean),
        ),
      );

      if (missingNames.length) {
        const payload = missingNames.map((name) => {
          const hash = crypto.randomUUID().slice(0, 8).toUpperCase();
          return {
            item_code: `AUTO-${hash}`,
            item_name: name,
            category: "مستورد تلقائياً",
            cost_price: 0,
            selling_price: 0,
            min_stock_level: 0,
            is_active: true,
          };
        });

        // Insert new items; if some already exist, insert may error — that's OK.
        const { error: createErr } = await supabase.from("items_master").insert(payload);
        if (createErr) {
          console.warn("Create items warning:", createErr);
        }

        // Fetch IDs for all missing names (whether newly created or already existed)
        const { data: resolvedItems, error: resolveErr } = await supabase
          .from("items_master")
          .select("id,item_name")
          .in("item_name", missingNames);

        if (resolveErr) throw resolveErr;

        const resolvedByNormalizedName = new Map<string, string>();
        for (const it of resolvedItems ?? []) {
          resolvedByNormalizedName.set(normalizeArabic(it.item_name), it.id);
        }

        // 2) Resolve final item_id for each line
        const finalLines = lines.map((l) => {
          if (l.item_id) return l;
          const key = normalizeArabic(String(l.source_name ?? "").trim());
          const resolvedId = resolvedByNormalizedName.get(key) ?? itemsIndex.byName.get(key);
          return resolvedId ? { ...l, item_id: resolvedId } : l;
        });

        // 3) Validate and upsert opening stock
        const validLines = finalLines.filter((l) => l.item_id && l.quantity > 0 && l.unit_cost > 0);
        if (validLines.length === 0) throw new Error("لا يوجد أي سطر صالح للحفظ بعد المطابقة");

        // IMPORTANT: Deduplicate by item_id to avoid: ON CONFLICT DO UPDATE cannot affect row a second time
        const mergedByItem = new Map<
          string,
          { item_id: string; quantity: number; unit_cost: number; entry_date: string }
        >();
        for (const l of validLines) {
          const key = l.item_id;
          const prev = mergedByItem.get(key);
          if (!prev) {
            mergedByItem.set(key, {
              item_id: key,
              quantity: l.quantity,
              unit_cost: l.unit_cost,
              entry_date: OPENING_STOCK_ENTRY_DATE,
            });
          } else {
            mergedByItem.set(key, {
              item_id: key,
              quantity: prev.quantity + l.quantity,
              unit_cost: l.unit_cost || prev.unit_cost,
              entry_date: OPENING_STOCK_ENTRY_DATE,
            });
          }
        }

        const upsertPayload = Array.from(mergedByItem.values());

        const { error } = await supabase
          .from("opening_stock")
          .upsert(upsertPayload, { onConflict: "item_id" });
        if (error) throw error;

        await queryClient.invalidateQueries({ queryKey: ["items"] });
        return;
      }

      // No missing names → normal flow
      const validLines = lines.filter((l) => l.item_id && l.quantity > 0 && l.unit_cost > 0);
      if (validLines.length === 0) {
        throw new Error("الرجاء إدخال بيانات صحيحة");
      }

      // IMPORTANT: Deduplicate by item_id to avoid: ON CONFLICT DO UPDATE cannot affect row a second time
      const mergedByItem = new Map<
        string,
        { item_id: string; quantity: number; unit_cost: number; entry_date: string }
      >();
      for (const l of validLines) {
        const key = l.item_id;
        const prev = mergedByItem.get(key);
        if (!prev) {
          mergedByItem.set(key, {
            item_id: key,
            quantity: l.quantity,
            unit_cost: l.unit_cost,
            entry_date: OPENING_STOCK_ENTRY_DATE,
          });
        } else {
          mergedByItem.set(key, {
            item_id: key,
            quantity: prev.quantity + l.quantity,
            unit_cost: l.unit_cost || prev.unit_cost,
            entry_date: OPENING_STOCK_ENTRY_DATE,
          });
        }
      }

      const upsertPayload = Array.from(mergedByItem.values());

      const { error } = await supabase
        .from("opening_stock")
        .upsert(upsertPayload, { onConflict: "item_id" });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حفظ الرصيد الافتتاحي بنجاح");
      queryClient.invalidateQueries({ queryKey: ["opening-stock"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      setLines([{ id: crypto.randomUUID(), item_id: "", quantity: 0, unit_cost: 0 }]);
    },
    onError: (error: any) => {
      toast.error("خطأ في الحفظ: " + error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("opening_stock")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حذف السجل بنجاح");
      queryClient.invalidateQueries({ queryKey: ["opening-stock"] });
    },
    onError: (error: any) => {
      toast.error("خطأ في الحذف: " + error.message);
    }
  });

  const addLine = () => {
    setLines([...lines, { id: crypto.randomUUID(), item_id: "", quantity: 0, unit_cost: 0 }]);
  };

  const removeLine = (id: string) => {
    if (lines.length > 1) {
      setLines(lines.filter(l => l.id !== id));
    }
  };

  const updateLine = (id: string, field: keyof OpeningStockLine, value: any) => {
    setLines(lines.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const handleSave = (e?: MouseEvent<HTMLButtonElement>) => {
    e?.preventDefault();
    e?.stopPropagation();

    console.log("[OpeningStock] Save clicked", { linesCount: lines.length });
    toast.message(`بدء الحفظ… (${lines.length} سطر)`);
    saveMutation.mutate(lines);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6" dir="rtl">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" onClick={() => navigate("/")}>
            <ArrowRight className="h-5 w-5" />
          </Button>
          <h1 className="text-3xl font-bold text-slate-900">الرصيد الافتتاحي للمخزون</h1>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>إدخال الرصيد الافتتاحي</CardTitle>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleImportFile(f);
                    e.currentTarget.value = "";
                  }}
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
                  استيراد الملف الأخير مرة أخرى
                </Button>

                {unmatchedLines.length > 0 && (
                  <Button type="button" variant="secondary" onClick={() => setMatcherOpen(true)}>
                    مطابقة العناصر غير المعروفة ({unmatchedLines.length})
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {lines.map((line, idx) => (
                <div key={line.id} className="grid grid-cols-13 gap-4 items-end">
                  <div className="col-span-1">
                    <label className="text-sm font-medium mb-1 block">رقم المسلسل</label>
                    <div className="h-10 flex items-center justify-center rounded-md bg-muted text-sm tabular-nums">
                      {idx + 1}
                    </div>
                  </div>

                  <div className="col-span-5">
                    <label className="text-sm font-medium mb-1 block">العنصر</label>
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
                  
                  <div className="col-span-3">
                    <label className="text-sm font-medium mb-1 block">الكمية</label>
                    <Input
                      type="number"
                      step="0.001"
                      value={line.quantity || ""}
                      onChange={(e) => updateLine(line.id, "quantity", parseFloat(e.target.value) || 0)}
                      placeholder="0.000"
                    />
                  </div>
                  
                  <div className="col-span-3">
                    <label className="text-sm font-medium mb-1 block">سعر التكلفة (د.ك)</label>
                    <Input
                      type="number"
                      step="0.001"
                      value={line.unit_cost || ""}
                      onChange={(e) => updateLine(line.id, "unit_cost", parseFloat(e.target.value) || 0)}
                      placeholder="0.000"
                    />
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

              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-t pt-4">
                <div className="text-sm text-muted-foreground">عدد السطور: {lines.length}</div>
                <div className="text-end space-y-1">
                  <div className="text-base font-semibold">إجمالي قيمة الفاتورة: {totals.actual.toFixed(3)} د.ك</div>
                  <div className="text-sm text-muted-foreground">الإجمالي المتوقع (بسعر البيع): {totals.expected.toFixed(3)} د.ك</div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={addLine} variant="outline">
                  <Plus className="h-4 w-4 ml-2" />
                  إضافة سطر
                </Button>
                {unmatchedLines.length > 0 && (
                  <Button type="button" variant="secondary" onClick={() => setMatcherOpen(true)}>
                    مطابقة العناصر غير المعروفة ({unmatchedLines.length})
                  </Button>
                )}
                <Button type="button" onClick={handleSave} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "جاري الحفظ..." : "حفظ"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>الرصيد الافتتاحي الحالي</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-right p-2">م</th>
                    <th className="text-right p-2">كود العنصر</th>
                    <th className="text-right p-2">اسم العنصر</th>
                    <th className="text-right p-2">التصنيف</th>
                    <th className="text-right p-2">الكمية</th>
                    <th className="text-right p-2">سعر التكلفة</th>
                    <th className="text-right p-2">القيمة الإجمالية</th>
                    <th className="text-center p-2">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {existingStock?.map((stock: any, idx: number) => (
                    <tr key={stock.id} className="border-b hover:bg-slate-50">
                      <td className="p-2 tabular-nums">{idx + 1}</td>
                      <td className="p-2">{stock.items_master.item_code}</td>
                      <td className="p-2">{stock.items_master.item_name}</td>
                      <td className="p-2">{stock.items_master.category}</td>
                      <td className="p-2">{parseFloat(stock.quantity).toFixed(3)}</td>
                      <td className="p-2">{parseFloat(stock.unit_cost).toFixed(3)} د.ك</td>
                      <td className="p-2 font-bold">{parseFloat(stock.total_value).toFixed(3)} د.ك</td>
                      <td className="p-2 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(stock.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30">
                    <td className="p-2" colSpan={6}>
                      <div className="text-sm font-medium">الإجمالي</div>
                    </td>
                    <td className="p-2 font-semibold tabular-nums" colSpan={2}>
                      <div className="text-sm">قيمة الرصيد الافتتاحي: {existingTotals.actual.toFixed(3)} د.ك</div>
                      <div className="text-xs text-muted-foreground">قيمة البيع المتوقعة: {existingTotals.expected.toFixed(3)} د.ك</div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* شاشة المطابقة */}
        <Dialog open={matcherOpen} onOpenChange={setMatcherOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>مطابقة الأصناف غير المعروفة</DialogTitle>
              <DialogDescription>
                اختر الصنف الصحيح لكل سطر غير مطابق. تم اقتراح أفضل النتائج تلقائياً.
              </DialogDescription>
            </DialogHeader>

            {unmatchedLines.length === 0 ? (
              <div className="text-sm text-muted-foreground">لا توجد عناصر تحتاج مطابقة.</div>
            ) : (
              <div className="space-y-3 max-h-[60vh] overflow-auto">
                {unmatchedLines.map((l) => {
                  const suggestions = getBestItemMatches(l.source_name ?? "", items as any, 4);
                  const picked = items?.find((it: any) => it.id === l.item_id);

                  return (
                    <div key={l.id} className="rounded-md border p-3">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">{l.source_name}</div>
                            <div className="text-xs text-muted-foreground">
                              الكمية: {l.quantity} — التكلفة: {l.unit_cost}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {picked ? `تم الاختيار: ${picked.item_code} - ${picked.item_name}` : "لم يتم اختيار صنف بعد"}
                          </div>
                        </div>

                        {suggestions.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {suggestions.map((s) => (
                              <Button
                                key={s.id}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => applyItemToLine(l.id, s.id)}
                              >
                                {s.label}
                              </Button>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center justify-end">
                          <Button type="button" variant="secondary" size="sm" onClick={() => openPickerForLine(l.id)}>
                            بحث واختيار…
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const still = lines.filter((x) => !x.item_id && !!x.source_name).length;
                  if (still > 0) toast.warning(`باقي ${still} سطر بدون مطابقة. يمكنك إغلاق النافذة والمتابعة لاحقاً.`);
                  setMatcherOpen(false);
                }}
              >
                إغلاق
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* نافذة بحث واحدة لاختيار الصنف */}
        <CommandDialog
          open={pickerOpen}
          onOpenChange={(open) => {
            setPickerOpen(open);
            if (!open) setActivePickLineId(null);
          }}
        >
          <CommandInput placeholder="ابحث عن الصنف..." />
          <CommandList>
            <CommandEmpty>لا توجد نتائج</CommandEmpty>

            {activePickLineId && (
              <>
                <CommandGroup heading="اقتراحات">
                  {getBestItemMatches(
                    (lines.find((x) => x.id === activePickLineId)?.source_name ?? ""),
                    items as any,
                    8
                  ).map((s) => (
                    <CommandItem
                      key={s.id}
                      value={s.label}
                      onSelect={() => {
                        applyItemToLine(activePickLineId, s.id);
                        setPickerOpen(false);
                      }}
                    >
                      {s.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandGroup heading="كل الأصناف">
                  {(items ?? []).map((it: any) => (
                    <CommandItem
                      key={it.id}
                      value={`${it.item_code} ${it.item_name}`}
                      onSelect={() => {
                        applyItemToLine(activePickLineId, it.id);
                        setPickerOpen(false);
                      }}
                    >
                      {it.item_code} - {it.item_name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </CommandDialog>
      </div>
    </div>
  );
};

export default OpeningStock;