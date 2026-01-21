import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Upload, RotateCcw, Wand2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { getBestItemMatches, normalizeArabic } from "@/lib/fuzzy";
import { parsePurchaseWorkbook, type PurchaseImportInvoice, type PurchaseImportLine } from "@/lib/purchaseExcel";

type ItemRow = { id: string; item_code?: string | null; item_name?: string | null };
type SupplierRow = { id: string; supplier_code?: string | null; supplier_name?: string | null };

type LastImportCache = {
  name: string;
  lastModified: number;
  dataBase64: string;
};

const LAST_IMPORT_STORAGE_KEY = "purchase_invoices:last_import:v1";
const MAX_CACHED_FILE_BYTES = 4_500_000;

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

export function PurchaseExcelImport(props: {
  items: ItemRow[] | undefined;
  suppliers: SupplierRow[] | undefined;
  invoices: PurchaseImportInvoice[];
  onInvoicesChange: (next: PurchaseImportInvoice[]) => void;
}) {
  const { items, suppliers, invoices, onInvoicesChange } = props;

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

  const [matcherOpen, setMatcherOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activePick, setActivePick] = useState<{ invoiceId: string; lineId: string } | null>(null);
  const [supplierAll, setSupplierAll] = useState<string>("");

  const itemsIndex = useMemo(() => {
    const byName = new Map<string, string>();
    const byCode = new Map<string, string>();
    (items ?? []).forEach((it) => {
      if (it.item_name) byName.set(normalizeArabic(it.item_name), it.id);
      if (it.item_code) byCode.set(normalizeArabic(it.item_code), it.id);
    });
    return { byName, byCode };
  }, [items]);

  const unmatchedLines = useMemo(() => {
    const out: Array<{ invoice: PurchaseImportInvoice; line: PurchaseImportLine }> = [];
    for (const inv of invoices) {
      for (const line of inv.lines) {
        if (!line.item_id && line.source_name) out.push({ invoice: inv, line });
      }
    }
    return out;
  }, [invoices]);

  const missingSupplierCount = useMemo(() => invoices.filter((inv) => !inv.supplier_id).length, [invoices]);

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
    const parsed = parsePurchaseWorkbook({ buf, items, suppliers });
    if (!parsed.length) {
      toast.error("لم يتم العثور على فواتير صالحة داخل الملف. تأكد أن كل Sheet يحتوي جدول أصناف (صنف/كمية/سعر). ");
      return;
    }

    onInvoicesChange(parsed);

    const totalInvoices = parsed.length;
    const totalLines = parsed.reduce((s, inv) => s + inv.lines.length, 0);
    const unmatched = parsed.reduce((s, inv) => s + inv.lines.filter((l) => !l.item_id).length, 0);

    if (unmatched > 0) {
      setMatcherOpen(true);
      toast.warning(`تم الاستيراد (${totalInvoices} فاتورة / ${totalLines} سطر). يوجد عناصر غير مطابقة: ${unmatched}`);
    } else {
      toast.success(`تم الاستيراد (${totalInvoices} فاتورة / ${totalLines} سطر).`);
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      cacheLastImport(file, buf);
      importFromArrayBuffer(buf);
    } catch (e: any) {
      toast.error("فشل الاستيراد: " + (e?.message || "خطأ غير معروف"));
    }
  };

  const handleReimportLastFile = async () => {
    try {
      const raw = localStorage.getItem(LAST_IMPORT_STORAGE_KEY);
      if (!raw) {
        toast.info("لا يوجد ملف سابق محفوظ للاستيراد.");
        return;
      }
      const cached = JSON.parse(raw) as LastImportCache;
      const buf = base64ToArrayBuffer(cached.dataBase64);
      importFromArrayBuffer(buf);
    } catch (e: any) {
      toast.error("تعذر استيراد الملف الأخير: " + (e?.message || "خطأ غير معروف"));
    }
  };

  const updateInvoice = (invoiceId: string, patch: Partial<PurchaseImportInvoice>) => {
    onInvoicesChange(invoices.map((inv) => (inv.id === invoiceId ? { ...inv, ...patch } : inv)));
  };

  const updateLine = (invoiceId: string, lineId: string, patch: Partial<PurchaseImportLine>) => {
    onInvoicesChange(
      invoices.map((inv) =>
        inv.id === invoiceId
          ? {
              ...inv,
              lines: inv.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)),
            }
          : inv,
      ),
    );
  };

  const addLine = (invoiceId: string) => {
    const nextLine: PurchaseImportLine = {
      id: crypto.randomUUID(),
      item_id: "",
      source_name: "",
      quantity_paid: 0,
      quantity_free: 0,
      unit_price: 0,
    };

    onInvoicesChange(
      invoices.map((inv) =>
        inv.id === invoiceId ? { ...inv, lines: [...inv.lines, nextLine] } : inv,
      ),
    );
  };

  const removeLine = (invoiceId: string, lineId: string) => {
    onInvoicesChange(
      invoices.map((inv) => {
        if (inv.id !== invoiceId) return inv;
        if (inv.lines.length <= 1) return inv;
        return { ...inv, lines: inv.lines.filter((l) => l.id !== lineId) };
      }),
    );
  };

  const openPickerForLine = (invoiceId: string, lineId: string) => {
    setActivePick({ invoiceId, lineId });
    setPickerOpen(true);
  };

  const applyItemToLine = (invoiceId: string, lineId: string, itemId: string) => {
    updateLine(invoiceId, lineId, { item_id: itemId });
  };

  const autoMatchAll = () => {
    if (!items?.length) return;

    onInvoicesChange(
      invoices.map((inv) => {
        const nextLines = inv.lines.map((l) => {
          if (l.item_id || !l.source_name) return l;
          const key = normalizeArabic(l.source_name);
          const direct = itemsIndex.byCode.get(key) || itemsIndex.byName.get(key);
          if (direct) return { ...l, item_id: direct };

          const best = getBestItemMatches(l.source_name, items as any, 1)[0];
          if (best && best.score >= 0.75) return { ...l, item_id: best.id };
          return l;
        });

        return { ...inv, lines: nextLines };
      }),
    );

    toast.message("تمت محاولة المطابقة التلقائية. راجع العناصر غير المطابقة إن وجدت.");
  };

  const applySupplierToAll = (mode: "missing" | "all") => {
    if (!supplierAll) {
      toast.info("اختر المورد أولاً.");
      return;
    }

    onInvoicesChange(
      invoices.map((inv) => {
        if (mode === "missing" && inv.supplier_id) return inv;
        return { ...inv, supplier_id: supplierAll };
      }),
    );

    toast.success(mode === "missing" ? "تم تعيين المورد للفواتير الناقصة." : "تم تعيين المورد لجميع الفواتير.");
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>استيراد فواتير مشتريات من Excel</CardTitle>
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
              استيراد الملف الأخير
            </Button>

            {unmatchedLines.length > 0 && (
              <Button type="button" variant="secondary" onClick={() => setMatcherOpen(true)}>
                مطابقة الأصناف ({unmatchedLines.length})
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            كل Sheet يعتبر فاتورة مستقلة. بعد الاستيراد ستشاهد معاينة (عدد الأصناف + الإجمالي) ويمكنك تعديل المورد/التاريخ/طريقة
            الدفع ومطابقة الأصناف.
          </p>

          {invoices.length > 0 && (
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
              <Button type="button" variant="outline" onClick={autoMatchAll}>
                <Wand2 className="h-4 w-4 ml-2" />
                مطابقة تلقائية
              </Button>

              <div className="flex flex-col md:flex-row md:items-end gap-2">
                <div className="w-[260px]">
                  <label className="text-xs font-medium mb-1 block">تعيين المورد للكل</label>
                  <select
                    className="w-full p-2 rounded-md border border-input bg-background text-foreground"
                    value={supplierAll}
                    onChange={(e) => setSupplierAll(e.target.value)}
                  >
                    <option value="">اختر المورد</option>
                    {suppliers?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.supplier_code} - {s.supplier_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2">
                  <Button type="button" variant="secondary" onClick={() => applySupplierToAll("missing")}
                    disabled={!invoices.length}
                  >
                    تطبيق على الناقص فقط
                  </Button>
                  <Button type="button" variant="outline" onClick={() => applySupplierToAll("all")}
                    disabled={!invoices.length}
                  >
                    تطبيق على الجميع
                  </Button>
                </div>
              </div>
            </div>
          )}

          {missingSupplierCount > 0 && (
            <div className="mt-3 text-sm">
              <span className="inline-flex items-center rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive">
                يوجد {missingSupplierCount} فاتورة بدون مورد — الرجاء اختيار المورد قبل الحفظ.
              </span>
            </div>
          )}
        </div>

        {/* Matcher */}
        <Dialog open={matcherOpen} onOpenChange={setMatcherOpen}>
          <DialogContent className="max-w-3xl" dir="rtl">
            <DialogHeader>
              <DialogTitle>مطابقة الأصناف غير المعروفة</DialogTitle>
              <DialogDescription>
                اختر الصنف الصحيح لكل سطر غير مطابق. يمكنك أيضاً الضغط على “مطابقة تلقائية” ثم مراجعة المتبقي.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[60vh] overflow-auto space-y-3">
              {unmatchedLines.length === 0 ? (
                <div className="text-sm text-muted-foreground">لا توجد عناصر غير مطابقة.</div>
              ) : (
                unmatchedLines.map(({ invoice, line }) => (
                  <div key={`${invoice.id}:${line.id}`} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-4 text-sm">
                      <div className="font-medium">{invoice.invoice_no}</div>
                      <div className="text-xs text-muted-foreground">Sheet: {invoice.source_sheet}</div>
                    </div>

                    <div className="col-span-4 text-sm">
                      <div className="font-medium">{line.source_name}</div>
                      <div className="text-xs text-muted-foreground">
                        كمية: {line.quantity_paid} | سعر: {line.unit_price}
                      </div>
                    </div>

                    <div className="col-span-4 flex gap-2 justify-end">
                      <Button type="button" variant="outline" onClick={() => openPickerForLine(invoice.id, line.id)}>
                        اختيار الصنف
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMatcherOpen(false)}>
                إغلاق
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Picker */}
        <CommandDialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <CommandInput placeholder="ابحث عن صنف…" />
          <CommandList>
            <CommandEmpty>لا توجد نتائج</CommandEmpty>
            <CommandGroup heading="الأصناف">
              {(items ?? []).slice(0, 200).map((it) => (
                <CommandItem
                  key={it.id}
                  value={`${it.item_code ?? ""} ${it.item_name ?? ""}`}
                  onSelect={() => {
                    if (!activePick) return;
                    applyItemToLine(activePick.invoiceId, activePick.lineId, it.id);
                    setPickerOpen(false);
                  }}
                >
                  {it.item_code ? `${it.item_code} - ${it.item_name}` : it.item_name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </CommandDialog>

        {/* Preview */}
        {invoices.length > 0 && (
          <div className="mt-6 space-y-6">
            {invoices.map((inv) => {
              const linesCount = inv.lines.length;
              const qtyTotal = inv.lines.reduce((s, l) => s + Number(l.quantity_paid ?? 0) + Number(l.quantity_free ?? 0), 0);
              const total = inv.lines.reduce((s, l) => s + Number(l.quantity_paid ?? 0) * Number(l.unit_price ?? 0), 0);
              const missingSupplier = !inv.supplier_id;

              return (
                <Card key={inv.id} className={missingSupplier ? "ring-1 ring-destructive/40" : undefined}>
                  <CardHeader>
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{inv.invoice_no}</CardTitle>
                        <div className="text-xs text-muted-foreground">Sheet: {inv.source_sheet}</div>
                      </div>

                      <div className="flex flex-wrap gap-2 items-end">
                        <div className="w-[180px]">
                          <label className="text-xs font-medium mb-1 block">التاريخ</label>
                          <Input
                            type="date"
                            value={inv.invoice_date}
                            onChange={(e) => updateInvoice(inv.id, { invoice_date: e.target.value })}
                          />
                        </div>

                        <div className="w-[220px]">
                          <label className="text-xs font-medium mb-1 block">المورد</label>
                          <select
                            className="w-full p-2 rounded-md border border-input bg-background text-foreground"
                            value={inv.supplier_id}
                            onChange={(e) => updateInvoice(inv.id, { supplier_id: e.target.value })}
                          >
                            <option value="">اختر المورد</option>
                            {suppliers?.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.supplier_code} - {s.supplier_name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="w-[160px]">
                          <label className="text-xs font-medium mb-1 block">الدفع</label>
                          <Input
                            value={inv.payment_method ?? ""}
                            onChange={(e) => updateInvoice(inv.id, { payment_method: e.target.value })}
                            placeholder="cash"
                          />
                        </div>

                        <div className="w-[120px]">
                          <label className="text-xs font-medium mb-1 block">هامش %</label>
                          <Input
                            type="number"
                            step="0.01"
                            value={inv.margin_percent}
                            onChange={(e) => updateInvoice(inv.id, { margin_percent: Number(e.target.value || 0) })}
                          />
                        </div>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent>
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-muted-foreground border-b">
                            <th className="py-2 px-2 text-right">م</th>
                            <th className="py-2 px-2 text-right">الصنف</th>
                            <th className="py-2 px-2 text-right">الكمية</th>
                            <th className="py-2 px-2 text-right">مجاني</th>
                            <th className="py-2 px-2 text-right">سعر الشراء</th>
                            <th className="py-2 px-2 text-right">سعر بيع متوقع</th>
                            <th className="py-2 px-2 text-right">إجمالي البيع المتوقع</th>
                            <th className="py-2 px-2 text-right">الإجمالي</th>
                            <th className="py-2 px-2 w-12"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {inv.lines.map((l, idx) => {
                            const expectedSell = Number(l.unit_price ?? 0) * (1 + Number(inv.margin_percent ?? 0) / 100);
                            const totalQty = Number(l.quantity_paid ?? 0) + Number(l.quantity_free ?? 0);
                            const expectedSellTotal = expectedSell * totalQty;
                            return (
                              <tr key={l.id} className="border-b">
                                <td className="py-2 px-2 tabular-nums">{idx + 1}</td>
                                <td className="py-2 px-2 min-w-[260px]">
                                  <select
                                    className="w-full p-2 border rounded-md"
                                    value={l.item_id}
                                    onChange={(e) => updateLine(inv.id, l.id, { item_id: e.target.value })}
                                  >
                                    <option value="">{l.source_name ? `غير مطابق: ${l.source_name}` : "اختر الصنف"}</option>
                                    {items?.map((it) => (
                                      <option key={it.id} value={it.id}>
                                        {it.item_code} - {it.item_name}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-2 px-2 w-[120px]">
                                  <Input
                                    type="number"
                                    step="0.001"
                                    value={l.quantity_paid}
                                    onChange={(e) => updateLine(inv.id, l.id, { quantity_paid: Number(e.target.value || 0) })}
                                  />
                                </td>
                                <td className="py-2 px-2 w-[120px]">
                                  <Input
                                    type="number"
                                    step="0.001"
                                    value={l.quantity_free}
                                    onChange={(e) => updateLine(inv.id, l.id, { quantity_free: Number(e.target.value || 0) })}
                                  />
                                </td>
                                <td className="py-2 px-2 w-[140px]">
                                  <Input
                                    type="number"
                                    step="0.001"
                                    value={l.unit_price}
                                    onChange={(e) => updateLine(inv.id, l.id, { unit_price: Number(e.target.value || 0) })}
                                  />
                                </td>
                                <td className="py-2 px-2 w-[140px] tabular-nums">
                                  {expectedSell.toFixed(3)}
                                </td>
                                <td className="py-2 px-2 w-[160px] tabular-nums">
                                  {expectedSellTotal.toFixed(3)}
                                </td>
                                <td className="py-2 px-2 w-[120px] tabular-nums">
                                  {(Number(l.quantity_paid ?? 0) * Number(l.unit_price ?? 0)).toFixed(3)}
                                </td>
                                <td className="py-2 px-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeLine(inv.id, l.id)}
                                    disabled={inv.lines.length <= 1}
                                    title="حذف السطر"
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

                    <div className="mt-3">
                      <Button type="button" variant="outline" onClick={() => addLine(inv.id)}>
                        <Plus className="h-4 w-4 ml-2" />
                        إضافة سطر
                      </Button>
                    </div>

                    <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-2 pt-4">
                      <div className="text-sm text-muted-foreground">
                        عدد السطور: {linesCount} | إجمالي الكمية: {qtyTotal.toFixed(3)}
                      </div>
                      <div className="text-lg font-bold">الإجمالي: {total.toFixed(3)} د.ك</div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
