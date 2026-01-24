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
import { useNavigate } from "react-router-dom";
import { useSalesStockPricing } from "@/hooks/useSalesStockPricing";
import { StockBalanceBreakdownDialog } from "@/components/sales/StockBalanceBreakdownDialog";

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
  /** Optional manual margin override (multiplier, e.g. 1.25). If unset, we use last purchase margin. */
  margin_factor?: number;
}

interface PreviewInvoice extends Omit<SalesExcelInvoice, "lines"> {
  lines: MatchedLine[];
  matchedCustomerId: string | null;
  salesRepId?: string | null;
  repCollects?: boolean;
  editing: boolean;
}

type InvoiceCardProps = {
  inv: PreviewInvoice;
  invIdx: number;
  items: any[] | undefined;
  customers: any[] | undefined;
  salesReps: any[] | undefined;
  updateInvoiceField: (idx: number, field: keyof PreviewInvoice, value: any) => void;
  updateLineField: (invIdx: number, lineIdx: number, field: keyof MatchedLine, value: any) => void;
  removeInvoice: (idx: number) => void;
  removeLine: (invIdx: number, lineIdx: number) => void;
  addLine: (invIdx: number) => void;
};

const PAYMENT_OPTIONS = [
  { value: "cash", label: "نقداً" },
  { value: "knet", label: "كي نت" },
  { value: "credit", label: "آجل" },
  { value: "bank_transfer", label: "تحويل بنكي" },
  { value: "visa", label: "فيزا" },
] as const;

function normalizePaymentMethod(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "cash";

  const v = raw.toLowerCase();
  if (v === "cash" || raw.includes("نقد")) return "cash";
  if (v === "knet" || raw.includes("كي نت") || raw.includes("كي-نت") || raw.includes("k-net")) return "knet";
  if (v === "credit" || raw.includes("آجل") || raw.includes("اجل")) return "credit";
  if (v === "bank_transfer" || raw.includes("تحويل") || raw.includes("بنك")) return "bank_transfer";
  if (v === "visa" || raw.includes("فيزا")) return "visa";
  return "other";
}

const InvoicePreviewCard = ({
  inv,
  invIdx,
  items,
  customers,
  salesReps,
  updateInvoiceField,
  updateLineField,
  removeInvoice,
  removeLine,
  addLine,
}: InvoiceCardProps) => {
  const navigate = useNavigate();

  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownItemId, setBreakdownItemId] = useState<string | null>(null);
  const hasUnmatched = inv.lines.some((l) => !l.matchedItemId);
  const lineCount = inv.lines.length;
  const grandTotal = inv.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0).toFixed(3);

  const itemIdsForInvoice = useMemo(
    () => inv.lines.map((l) => l.matchedItemId).filter(Boolean),
    [inv.lines]
  );

  const { data: stockPricingMap } = useSalesStockPricing({
    itemIds: itemIdsForInvoice,
    invoiceDate: inv.invoiceDate,
  });

  const expectedSellingTotal = useMemo(() => {
    return inv.lines.reduce((sum, line) => {
      const q = getDisplayQuantities({ quantity: line.quantity, notes: line.notes ?? null });
      const soldQty = Number(q.sold ?? 0);
      const sp = line.matchedItemId ? stockPricingMap?.[line.matchedItemId] : undefined;
      const purchaseUnit = Number(sp?.lastPurchaseUnitPrice ?? 0);
      const purchaseMarginMultiplier = Number(sp?.lastPurchaseMarginFactor ?? NaN);
      const manualMarginPct = Number(line.margin_factor);
      const usedMarginMultiplier = Number.isFinite(manualMarginPct)
        ? 1 + manualMarginPct / 100
        : Number.isFinite(purchaseMarginMultiplier)
          ? purchaseMarginMultiplier
          : 1.09;
      const expectedUnit = purchaseUnit * usedMarginMultiplier;
      if (!Number.isFinite(soldQty) || !Number.isFinite(expectedUnit)) return sum;
      return sum + soldQty * expectedUnit;
    }, 0);
  }, [inv.lines, stockPricingMap]);

  const expectedDiff = useMemo(() => {
    const actual = Number(grandTotal);
    return Number(expectedSellingTotal) - actual;
  }, [expectedSellingTotal, grandTotal]);

  return (
    <Card key={invIdx} className={hasUnmatched ? "border-amber-400" : "border-green-400"}>
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
              onClick={() => updateInvoiceField(invIdx, "editing", !inv.editing)}
            >
              <Edit2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => removeInvoice(invIdx)}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <StockBalanceBreakdownDialog
          open={breakdownOpen}
          onOpenChange={setBreakdownOpen}
          itemId={breakdownItemId}
          invoiceDate={inv.invoiceDate}
        />

        {inv.editing ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="text-sm font-medium">رقم الفاتورة</label>
              <Input
                value={inv.invoiceNo}
                onChange={(e) => updateInvoiceField(invIdx, "invoiceNo", e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">التاريخ</label>
              <Input
                type="date"
                value={inv.invoiceDate}
                onChange={(e) => updateInvoiceField(invIdx, "invoiceDate", e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">العميل</label>
              <select
                className="w-full p-2 border rounded-md"
                value={inv.matchedCustomerId ?? ""}
                onChange={(e) => updateInvoiceField(invIdx, "matchedCustomerId", e.target.value || null)}
              >
                <option value="">مجهول</option>
                {customers?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.customer_code} - {c.customer_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">طريقة الدفع</label>
              <div className="space-y-2">
                <select
                  className="w-full p-2 border rounded-md"
                  value={normalizePaymentMethod(inv.paymentMethod)}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === "other") {
                      // Keep the existing text (if any) so user can edit it below.
                      updateInvoiceField(invIdx, "paymentMethod", inv.paymentMethod || "");
                      return;
                    }
                    updateInvoiceField(invIdx, "paymentMethod", next);
                  }}
                >
                  {PAYMENT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                  <option value="other">أخرى…</option>
                </select>

                {normalizePaymentMethod(inv.paymentMethod) === "other" && (
                  <Input
                    value={inv.paymentMethod}
                    onChange={(e) => updateInvoiceField(invIdx, "paymentMethod", e.target.value)}
                    placeholder="اكتب طريقة الدفع"
                  />
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">مندوب المبيعات</label>
              <select
                className="w-full p-2 border rounded-md"
                value={inv.salesRepId ?? ""}
                onChange={(e) => updateInvoiceField(invIdx, "salesRepId", e.target.value || null)}
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
              <input
                id={`rep_collects_${invIdx}`}
                type="checkbox"
                className="h-4 w-4"
                checked={Boolean(inv.repCollects)}
                onChange={(e) => updateInvoiceField(invIdx, "repCollects", e.target.checked)}
              />
              <label htmlFor={`rep_collects_${invIdx}`} className="text-sm font-medium">
                المندوب مسؤول عن التحصيل
              </label>
            </div>

            <div className="md:col-span-4">
              <label className="text-sm font-medium">ملاحظة</label>
              <Input value={inv.notes ?? ""} onChange={(e) => updateInvoiceField(invIdx, "notes", e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground mb-2">
            {inv.invoiceDate} |{" "}
            {inv.matchedCustomerId
              ? customers?.find((c) => c.id === inv.matchedCustomerId)?.customer_name ?? "عميل"
              : "مجهول"}{" "}
            | {inv.paymentMethod || "cash"}
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
                <th className="p-2 text-end">الكمية المسحوبة</th>
                <th className="p-2 text-end">مرتجع لعدم البيع</th>
                <th className="p-2 text-end">الكمية المباعه</th>
                <th className="p-2 text-end">السعر للوحدة</th>
                <th className="p-2 text-end">الإجمالي</th>
                <th className="p-2 text-end border-s-2 border-amber-400 bg-amber-50">رصيد المخزن</th>
                <th className="p-2 text-end bg-amber-50">سعر الوحدة-شراء</th>
                <th className="p-2 text-end bg-amber-50">هامش %</th>
                <th className="p-2 text-end bg-amber-50">سعر البيع المتوقع للوحدة</th>
                <th className="p-2 text-end bg-amber-50">إجمالي سعر البيع المتوقع</th>
                <th className="p-2 text-end border-e-2 border-amber-400 bg-amber-50">فرق البيع عن المتوقع</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((line, lineIdx) => (
                (() => {
                  const q = getDisplayQuantities({ quantity: line.quantity, notes: line.notes ?? null });
                  const returned = q.returned;
                  const withdrawn = q.withdrawn;
                  const sold = q.sold;

                  const updateQtyMeta = (next: { returned?: number; withdrawn?: number }) => {
                    const nextReturned = next.returned ?? returned;
                    const nextWithdrawn = next.withdrawn ?? withdrawn;
                    const nextSold = Number(nextWithdrawn) - Number(nextReturned);

                    const merged = mergeNotesWithQuantities(line.notes ?? null, {
                      sold: nextSold,
                      returned: nextReturned,
                      withdrawn: nextWithdrawn,
                    });
                    updateLineField(invIdx, lineIdx, "notes", merged ?? "");

                    // Keep the main quantity (used in totals) always aligned with the sold quantity.
                    updateLineField(invIdx, lineIdx, "quantity", nextSold);
                  };

                  const sp = line.matchedItemId ? stockPricingMap?.[line.matchedItemId] : undefined;
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
                  const actualLineTotal = Number(line.quantity * line.unitPrice);
                  const expectedTotal = Number(sold || 0) * expectedUnit;
                  const diffFromExpected = expectedTotal - actualLineTotal;
                  const purchaseHeaderId = sp?.lastPurchaseHeaderId ?? null;
                  const purchaseInvoiceNo = sp?.lastPurchaseInvoiceNo ?? null;

                  const stockWarn = Number(sold || 0) > stockBalance;
                  const diffWarn = diffFromExpected < 0;

                  return (
                    <tr key={lineIdx} className={line.matchedItemId ? "" : "bg-amber-50"}>
                      <td className="p-2">{lineIdx + 1}</td>
                      <td className="p-2">{line.itemCode}</td>
                      <td className="p-2">{line.itemName}</td>
                      <td className="p-2">
                        {inv.editing || !line.matchedItemId ? (
                          <select
                            className="w-full p-1 border rounded text-sm"
                            value={line.matchedItemId ?? ""}
                            onChange={(e) => updateLineField(invIdx, lineIdx, "matchedItemId", e.target.value || null)}
                          >
                            <option value="">اختر الصنف</option>
                            {items?.map((it) => (
                              <option key={it.id} value={it.id}>
                                {it.item_code} - {it.item_name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-green-700">{line.matchedItemName}</span>
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
                            value={sold}
                            readOnly
                            disabled
                            title="يتم احتساب الكمية المباعه تلقائياً = الكمية المسحوبة - مرتجع لعدم البيع"
                          />
                        ) : (
                          Number(sold || 0).toFixed(3)
                        )}
                      </td>

                      <td className="p-2 text-end tabular-nums">
                        {inv.editing ? (
                          <Input
                            type="number"
                            step="0.001"
                            className="w-24 text-end"
                            value={line.unitPrice}
                            onChange={(e) => updateLineField(invIdx, lineIdx, "unitPrice", parseFloat(e.target.value) || 0)}
                          />
                        ) : (
                          line.unitPrice.toFixed(3)
                        )}
                      </td>

                       <td className="p-2 text-end tabular-nums">{actualLineTotal.toFixed(3)}</td>

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
                             setBreakdownItemId(line.matchedItemId);
                             setBreakdownOpen(true);
                           }}
                           disabled={!line.matchedItemId}
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
                         {inv.editing ? (
                           <Input
                             type="number"
                             step="0.001"
                             className="w-24 text-end"
                             value={Number.isFinite(Number(line.margin_factor)) ? String(line.margin_factor) : ""}
                             onChange={(e) => {
                               const raw = e.target.value;
                               updateLineField(
                                 invIdx,
                                 lineIdx,
                                 "margin_factor",
                                 raw.trim() === "" ? undefined : parseFloat(raw) || 0
                               );
                             }}
                              placeholder={Number.isFinite(purchaseMarginPct) ? purchaseMarginPct.toFixed(3) : "9.000"}
                              title="هامش الربح المتوقع (%). اتركه فارغاً لاستخدام هامش آخر فاتورة شراء، وإن لم يوجد فسيتم استخدام 9%."
                           />
                         ) : (
                            (Number.isFinite(manualMarginPct)
                              ? manualMarginPct
                              : Number.isFinite(purchaseMarginPct)
                                ? purchaseMarginPct
                                : 9
                            ).toFixed(3) + "%"
                         )}
                       </td>
                       <td className="p-2 text-end tabular-nums bg-amber-50">{expectedUnit.toFixed(3)}</td>
                       <td className="p-2 text-end tabular-nums bg-amber-50">{expectedTotal.toFixed(3)}</td>
                       <td
                         className={
                           "p-2 text-end tabular-nums border-e-2 border-amber-400 bg-amber-50 " +
                           (diffWarn ? "text-destructive font-semibold" : "")
                         }
                       >
                         {diffFromExpected.toFixed(3)}
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
        <div className="mt-4 pt-2 border-t space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">عدد الأصناف: {lineCount}</span>
            <span className="font-bold">الإجمالي: {grandTotal} د.ك</span>
          </div>
          <div className="flex justify-between items-center text-sm text-muted-foreground">
            <span>إجمالي سعر البيع المتوقع:</span>
            <span className="tabular-nums">{expectedSellingTotal.toFixed(3)} د.ك</span>
          </div>
          <div className="flex justify-between items-center text-sm text-muted-foreground">
            <span>الفرق (المتوقع - الإجمالي):</span>
            <span className="tabular-nums">{expectedDiff.toFixed(3)} د.ك</span>
          </div>
          {!inv.editing && String(inv.notes ?? "").trim() && (
            <div className="text-sm pt-2 border-t">
              <span className="font-semibold">ملاحظة: </span>
              <span>{inv.notes}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

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

        // Ensure "quantity" (used for totals) always reflects sold quantity.
        // Sold is defined as: withdrawn - returned.
        const q = getDisplayQuantities({ quantity: (line as any).quantity, notes: (line as any).notes ?? null });
        return {
          ...line,
          quantity: q.sold,
          matchedItemId: match.id,
          matchedItemName: match.name,
          margin_factor: undefined,
        };
      });
      return {
        ...inv,
        lines: matchedLines,
        matchedCustomerId: matchCustomer(inv.customerCode, inv.customerName),
        salesRepId: null,
        repCollects: false,
        paymentMethod: (() => {
          const normalized = normalizePaymentMethod(inv.paymentMethod);
          if (normalized === "other") return String(inv.paymentMethod ?? "").trim();
          return normalized;
        })(),
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
      margin_factor: undefined,
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
        const normalizedPayment = normalizePaymentMethod(inv.paymentMethod);
        const paymentMethodForDb =
          normalizedPayment === "other"
            ? String(inv.paymentMethod ?? "").trim() || "cash"
            : normalizedPayment || "cash";

        // --- Normalize & validate lines for DB ---
        // DB enforces quantity > 0 on sales_lines. In our Excel template we may have
        // withdrawn/returned quantities which can lead to sold=0 or negative.
        // We only persist lines with sold quantity > 0.
        const normalizedLines = (inv.lines ?? []).map((l) => {
          const q = getDisplayQuantities({ quantity: l.quantity, notes: l.notes ?? null });
          const soldQty = Number(q.sold ?? l.quantity);
          return {
            ...l,
            // Keep DB quantity aligned with sold quantity.
            quantity: soldQty,
          };
        });

        const linesToInsert = normalizedLines.filter((l) => Number(l.quantity) > 0);

        if (linesToInsert.length === 0) {
          throw new Error(
            `لا يمكن حفظ الفاتورة ${invoiceNo}: جميع السطور نتيجتها "الكمية المباعه" = 0 (أو سالبة). عدّل المسحوب/المرتجع بحيث تصبح الكمية المباعه > 0.`
          );
        }

        // Validate quantities before saving to avoid DB check constraint failures.
        // DB expects quantity > 0 for every sales line.
        const badQtyLines = linesToInsert
          .map((l, idx) => ({
            idx,
            itemLabel: l.itemCode || l.itemName || `#${idx + 1}`,
            qty: Number(l.quantity),
          }))
          .filter((x) => !Number.isFinite(x.qty) || x.qty <= 0);

        if (badQtyLines.length > 0) {
          const sample = badQtyLines
            .slice(0, 3)
            .map((x) => `${x.itemLabel} (سطر ${x.idx + 1}: ${String(x.qty)})`)
            .join("، ");
          throw new Error(
            `لا يمكن حفظ الفاتورة ${invoiceNo}: توجد سطور بكمية غير صالحة (يجب أن تكون > 0). مثال: ${sample}`
          );
        }

        const badPriceLines = inv.lines
          .map((l, idx) => ({ idx, unitPrice: Number(l.unitPrice) }))
          .filter((x) => !Number.isFinite(x.unitPrice) || x.unitPrice <= 0);

        if (badPriceLines.length > 0) {
          throw new Error(
            `لا يمكن حفظ الفاتورة ${invoiceNo}: يوجد سطر/سطور بسعر غير صالح (يجب أن يكون > 0).`
          );
        }

        const totalAmount = linesToInsert.reduce(
          (sum, l) => sum + Number(l.quantity) * Number(l.unitPrice),
          0
        );

        // HARD guarantee: reserve invoice number in the global register first.
        // This prevents race conditions between duplicate-check and save.
        const { error: regReserveError } = await supabase.from("invoice_register").insert({
          invoice_no: invoiceNo,
          invoice_type: "SALES",
        });
        if (regReserveError) throw regReserveError;

        try {
          const { data: header, error: headerError } = await supabase
            .from("sales_headers")
            .insert({
              invoice_no: invoiceNo,
              customer_id: inv.matchedCustomerId,
              invoice_date: inv.invoiceDate,
              total_amount: totalAmount,
              payment_method: paymentMethodForDb,
              notes: inv.notes,
              sales_rep_id: inv.salesRepId ?? null,
              rep_collects: Boolean(inv.repCollects),
            })
            .select()
            .single();

          if (headerError) throw headerError;

          const { error: linesError } = await supabase.from("sales_lines").insert(
            linesToInsert.map((line, idx) => ({
              sales_header_id: header.id,
              line_no: idx + 1,
              item_id: line.matchedItemId!,
              quantity: Number(line.quantity),
              unit_price: Number(line.unitPrice),
              notes: line.notes ?? null,
            }))
          );

          if (linesError) throw linesError;
        } catch (e) {
          // If anything fails after reserving the invoice number, release it.
          await supabase
            .from("invoice_register")
            .delete()
            .eq("invoice_type", "SALES")
            .eq("invoice_no", invoiceNo);
          throw e;
        }
      }

      return toSave.length;
    },
    onSuccess: (count) => {
      toast.success(`تم حفظ ${count} فاتورة مبيعات بنجاح`);
      queryClient.invalidateQueries({ queryKey: ["sales-list"] });
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

          {previews.map((inv, invIdx) => (
            <InvoicePreviewCard
              key={invIdx}
              inv={inv}
              invIdx={invIdx}
              items={items}
              customers={customers}
              salesReps={salesReps}
              updateInvoiceField={updateInvoiceField}
              updateLineField={updateLineField}
              removeInvoice={removeInvoice}
              removeLine={removeLine}
              addLine={addLine}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default SalesExcelImport;
