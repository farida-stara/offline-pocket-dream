import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Loader2 } from "lucide-react";
import { fetchOpeningBaselineDate } from "@/lib/openingBaseline";

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

type BreakdownRow = {
  opening: {
    startDate: string;
    lines: Array<{ entry_date: string; quantity: number }>;
    totalQty: number;
  };
  purchases: {
    lines: Array<{
      headerId: string;
      invoiceNo: string;
      invoiceDate: string;
      qty: number;
      unitPrice: number;
      marginFactor: number;
    }>;
    totalQty: number;
  };
  wastage: {
    lines: Array<{ headerId: string; wastageNo: string; wastageDate: string; qty: number }>;
    totalQty: number;
  };
  previousSales: {
    lines: Array<{ headerId: string; invoiceNo: string; invoiceDate: string; qty: number }>;
    totalQty: number;
  };
  stockBalance: number;
};

export function StockBalanceBreakdownDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string | null;
  invoiceDate: string | null;
  excludeSalesHeaderId?: string | null;
}) {
  const navigate = useNavigate();
  const enabled = Boolean(props.open && props.itemId && props.invoiceDate);

  const { data, isLoading, isError } = useQuery({
    enabled,
    queryKey: [
      "stock-balance-breakdown",
      props.itemId ?? "",
      props.invoiceDate ?? "",
      props.excludeSalesHeaderId ?? "",
    ],
    queryFn: async (): Promise<BreakdownRow> => {
      const itemId = props.itemId!;
      const invoiceDate = props.invoiceDate!;
      const excludeSalesHeaderId = props.excludeSalesHeaderId ?? null;

      const baselineDate = (await fetchOpeningBaselineDate()) ?? "0001-01-01";

      // Opening stock is fixed baseline (start of work)
      const { data: openingRows, error: openingErr } = await supabase
        .from("opening_stock")
        .select("entry_date, quantity")
        .eq("item_id", itemId)
        .eq("entry_date", baselineDate)
        .order("entry_date", { ascending: true });
      if (openingErr) throw openingErr;

      const openingLines = (openingRows ?? []).map((r: any) => ({
        entry_date: String(r.entry_date ?? ""),
        quantity: toNum(r.quantity),
      }));
      const startDate = baselineDate;
      const openingTotalQty = openingLines.reduce((s, r) => s + r.quantity, 0);

      // Purchases within [startDate..invoiceDate]
      const { data: purchaseRows, error: purchaseErr } = await supabase
        .from("purchase_lines")
        .select(
          `quantity_paid, quantity_free, unit_price, margin_factor, header:purchase_headers(id, invoice_no, invoice_date)`
        )
        .eq("item_id", itemId);
      if (purchaseErr) throw purchaseErr;

      const purchasesLines: BreakdownRow["purchases"]["lines"] = [];
      for (const r of purchaseRows ?? []) {
        const header = (r as any).header as any;
        const d = String(header?.invoice_date ?? "");
        if (!d) continue;
        if (d < startDate || d > invoiceDate) continue;

        purchasesLines.push({
          headerId: String(header?.id ?? ""),
          invoiceNo: String(header?.invoice_no ?? ""),
          invoiceDate: d,
          qty: toNum((r as any).quantity_paid) + toNum((r as any).quantity_free),
          unitPrice: toNum((r as any).unit_price),
          marginFactor: toNum((r as any).margin_factor ?? 1),
        });
      }

      // Wastage within [startDate..invoiceDate]
      const { data: wastageRows, error: wastageErr } = await supabase
        .from("wastage_lines")
        .select(`quantity, header:wastage_headers(id, wastage_no, wastage_date)`)
        .eq("item_id", itemId);
      if (wastageErr) throw wastageErr;

      const wastageLines: BreakdownRow["wastage"]["lines"] = [];
      for (const r of wastageRows ?? []) {
        const header = (r as any).header as any;
        const d = String(header?.wastage_date ?? "");
        if (!d) continue;
        if (d < startDate || d > invoiceDate) continue;
        wastageLines.push({
          headerId: String(header?.id ?? ""),
          wastageNo: String(header?.wastage_no ?? ""),
          wastageDate: d,
          qty: toNum((r as any).quantity),
        });
      }

      // Previous sales within [startDate..invoiceDate]
      const { data: salesRows, error: salesErr } = await supabase
        .from("sales_lines")
        .select(`quantity, sales_header_id, header:sales_headers(id, invoice_no, invoice_date)`)
        .eq("item_id", itemId);
      if (salesErr) throw salesErr;

      const previousSalesLines: BreakdownRow["previousSales"]["lines"] = [];
      for (const r of salesRows ?? []) {
        const salesHeaderId = String((r as any).sales_header_id ?? "");
        if (excludeSalesHeaderId && salesHeaderId === excludeSalesHeaderId) continue;

        const header = (r as any).header as any;
        const d = String(header?.invoice_date ?? "");
        if (!d) continue;
        if (d < startDate || d > invoiceDate) continue;
        previousSalesLines.push({
          headerId: String(header?.id ?? salesHeaderId),
          invoiceNo: String(header?.invoice_no ?? ""),
          invoiceDate: d,
          qty: toNum((r as any).quantity),
        });
      }

      const purchasesTotalQty = purchasesLines.reduce((s, r) => s + r.qty, 0);
      const wastageTotalQty = wastageLines.reduce((s, r) => s + r.qty, 0);
      const previousSalesTotalQty = previousSalesLines.reduce((s, r) => s + r.qty, 0);
      const stockBalance = openingTotalQty + purchasesTotalQty - previousSalesTotalQty - wastageTotalQty;

      return {
        opening: { startDate, lines: openingLines, totalQty: openingTotalQty },
        purchases: { lines: purchasesLines, totalQty: purchasesTotalQty },
        wastage: { lines: wastageLines, totalQty: wastageTotalQty },
        previousSales: { lines: previousSalesLines, totalQty: previousSalesTotalQty },
        stockBalance,
      };
    },
  });

  const summary = useMemo(() => {
    if (!data) return null;
    return {
      startDate: data.opening.startDate,
      invoiceDate: props.invoiceDate ?? "",
      opening: data.opening.totalQty,
      purchases: data.purchases.totalQty,
      previousSales: data.previousSales.totalQty,
      wastage: data.wastage.totalQty,
      balance: data.stockBalance,
    };
  }, [data, props.invoiceDate]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent dir="rtl" className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>مصدر حساب رصيد المخزن</DialogTitle>
        </DialogHeader>

        {!props.itemId || !props.invoiceDate ? (
          <div className="text-sm text-muted-foreground">اختر صنفًا وتاريخ فاتورة أولاً.</div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError || !data ? (
          <div className="text-sm text-destructive">تعذر تحميل مصدر الحساب.</div>
        ) : (
          <div className="space-y-4">
            {summary && (
              <div className="text-sm">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div>
                    <div className="text-muted-foreground">الفترة</div>
                    <div className="font-medium">
                      {summary.startDate} → {summary.invoiceDate}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">المعادلة</div>
                    <div className="font-medium">افتتاحي + مشتريات − مبيعات سابقة − توالف</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">الرصيد النهائي</div>
                    <div className="font-semibold tabular-nums">{summary.balance.toFixed(3)}</div>
                  </div>
                </div>

                <Separator className="my-3" />

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">افتتاحي</div>
                    <div className="font-semibold tabular-nums">{summary.opening.toFixed(3)}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">مشتريات</div>
                    <div className="font-semibold tabular-nums">{summary.purchases.toFixed(3)}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">مبيعات سابقة</div>
                    <div className="font-semibold tabular-nums">{summary.previousSales.toFixed(3)}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">توالف</div>
                    <div className="font-semibold tabular-nums">{summary.wastage.toFixed(3)}</div>
                  </div>
                </div>
              </div>
            )}

            <Accordion type="multiple" defaultValue={["opening", "purchases", "previousSales", "wastage"]}>
              <AccordionItem value="opening">
                <AccordionTrigger>الافتتاحي ({data.opening.totalQty.toFixed(3)})</AccordionTrigger>
                <AccordionContent>
                  {data.opening.lines.length === 0 ? (
                    <div className="text-sm text-muted-foreground">لا توجد حركات افتتاحية ضمن الفترة.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right">التاريخ</TableHead>
                          <TableHead className="text-right">الكمية</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.opening.lines.map((r, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="tabular-nums">{r.entry_date}</TableCell>
                            <TableCell className="tabular-nums">{r.quantity.toFixed(3)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="purchases">
                <AccordionTrigger>المشتريات ({data.purchases.totalQty.toFixed(3)})</AccordionTrigger>
                <AccordionContent>
                  {data.purchases.lines.length === 0 ? (
                    <div className="text-sm text-muted-foreground">لا توجد مشتريات ضمن الفترة.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right">التاريخ</TableHead>
                          <TableHead className="text-right">رقم الفاتورة</TableHead>
                          <TableHead className="text-right">الكمية</TableHead>
                          <TableHead className="text-right">سعر الشراء</TableHead>
                          <TableHead className="text-right">الهامش</TableHead>
                          <TableHead className="text-right"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.purchases.lines.map((r, idx) => (
                          <TableRow key={`${r.headerId}-${idx}`}>
                            <TableCell className="tabular-nums">{r.invoiceDate}</TableCell>
                            <TableCell className="font-mono">{r.invoiceNo || "-"}</TableCell>
                            <TableCell className="tabular-nums">{r.qty.toFixed(3)}</TableCell>
                            <TableCell className="tabular-nums">{r.unitPrice.toFixed(3)}</TableCell>
                            <TableCell className="tabular-nums">{r.marginFactor.toFixed(3)}</TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                variant="link"
                                className="h-auto p-0"
                                onClick={() => navigate(`/purchases/${r.headerId}`)}
                              >
                                فتح
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="previousSales">
                <AccordionTrigger>المبيعات السابقة ({data.previousSales.totalQty.toFixed(3)})</AccordionTrigger>
                <AccordionContent>
                  {data.previousSales.lines.length === 0 ? (
                    <div className="text-sm text-muted-foreground">لا توجد مبيعات سابقة ضمن الفترة.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right">التاريخ</TableHead>
                          <TableHead className="text-right">رقم الفاتورة</TableHead>
                          <TableHead className="text-right">الكمية</TableHead>
                          <TableHead className="text-right"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.previousSales.lines.map((r, idx) => (
                          <TableRow key={`${r.headerId}-${idx}`}>
                            <TableCell className="tabular-nums">{r.invoiceDate}</TableCell>
                            <TableCell className="font-mono">{r.invoiceNo || "-"}</TableCell>
                            <TableCell className="tabular-nums">{r.qty.toFixed(3)}</TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                variant="link"
                                className="h-auto p-0"
                                onClick={() => navigate(`/sales/${r.headerId}`)}
                              >
                                فتح
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="wastage">
                <AccordionTrigger>التوالف ({data.wastage.totalQty.toFixed(3)})</AccordionTrigger>
                <AccordionContent>
                  {data.wastage.lines.length === 0 ? (
                    <div className="text-sm text-muted-foreground">لا توجد توالف ضمن الفترة.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right">التاريخ</TableHead>
                          <TableHead className="text-right">رقم السجل</TableHead>
                          <TableHead className="text-right">الكمية</TableHead>
                          <TableHead className="text-right"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.wastage.lines.map((r, idx) => (
                          <TableRow key={`${r.headerId}-${idx}`}>
                            <TableCell className="tabular-nums">{r.wastageDate}</TableCell>
                            <TableCell className="font-mono">{r.wastageNo || "-"}</TableCell>
                            <TableCell className="tabular-nums">{r.qty.toFixed(3)}</TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                variant="link"
                                className="h-auto p-0"
                                onClick={() => navigate(`/wastage/${r.headerId}`)}
                              >
                                فتح
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
