import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { PurchaseExcelImport } from "@/components/purchases/PurchaseExcelImport";
import { PurchaseManualEntry } from "@/components/purchases/PurchaseManualEntry";
import type { PurchaseImportInvoice } from "@/lib/purchaseExcel";
import { checkDuplicateInvoices } from "@/hooks/useInvoiceDuplicateCheck";

const PurchaseEntry = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<"manual" | "excel">("excel");
  const [invoices, setInvoices] = useState<PurchaseImportInvoice[]>([]);

  const { data: items } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("items_master").select("*").eq("is_active", true).order("item_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").eq("is_active", true).order("supplier_name");
      if (error) throw error;
      return data;
    },
  });

  const saveImportedMutation = useMutation({
    mutationFn: async () => {
      if (!invoices.length) throw new Error("لا توجد فواتير للحفظ");

      const normalizePurchaseInvoiceNo = (raw: string) => {
        const v = (raw ?? "").trim();
        if (!v) return v;
        // enforce P- prefix for purchases (keeps uniqueness clean across the system)
        return /^[a-zA-Z]+-/.test(v) ? v : `P-${v}`;
      };

      // Basic validation (show exactly what is missing)
      const invalidInvoice = invoices.find((inv) => !inv.invoice_no || !inv.invoice_date || !inv.supplier_id);
      if (invalidInvoice) {
        const missing: string[] = [];
        if (!invalidInvoice.invoice_no) missing.push("رقم الفاتورة");
        if (!invalidInvoice.invoice_date) missing.push("تاريخ الفاتورة");
        if (!invalidInvoice.supplier_id) missing.push("المورد");
        const who = invalidInvoice.invoice_no || invalidInvoice.source_sheet;
        throw new Error(`الرجاء استكمال البيانات التالية (${missing.join(" / ")}) للفاتورة: ${who}`);
      }

      const anyMissingItems = invoices.some((inv) => inv.lines.some((l) => !l.item_id));
      if (anyMissingItems) {
        throw new Error("يوجد أسطر بدون صنف (غير مطابق). الرجاء مطابقة جميع الأصناف قبل الحفظ.");
      }

      // Check for duplicates
      const invoiceNumbers = invoices.map((inv) => normalizePurchaseInvoiceNo(inv.invoice_no));
      const duplicates = await checkDuplicateInvoices(invoiceNumbers, "PURCHASE");
      if (duplicates.length > 0) {
        throw new Error(`تحذير: أرقام الفواتير التالية موجودة مسبقاً: ${duplicates.join(", ")}`);
      }

      // Save sequentially to keep logic simple
      for (const inv of invoices) {
        const normalizedInvoiceNo = normalizePurchaseInvoiceNo(inv.invoice_no);
        const validLines = inv.lines.filter((l) => l.item_id && l.quantity_paid > 0 && l.unit_price > 0);
        if (!validLines.length) {
          throw new Error(`لا يوجد أسطر صالحة داخل الفاتورة: ${normalizedInvoiceNo}`);
        }

        const totalAmount = validLines.reduce((sum, l) => sum + Number(l.quantity_paid) * Number(l.unit_price), 0);

        const { data: header, error: headerError } = await supabase
          .from("purchase_headers")
          .insert({
            invoice_no: normalizedInvoiceNo,
            supplier_id: inv.supplier_id,
            invoice_date: inv.invoice_date,
            total_amount: totalAmount,
            payment_method: inv.payment_method || "cash",
            payment_status: inv.payment_status || null,
            notes: inv.notes || null,
          })
          .select()
          .single();

        if (headerError) throw headerError;

        const { error: linesError } = await supabase.from("purchase_lines").insert(
          validLines.map((line, idx) => ({
            purchase_header_id: header.id,
            line_no: idx + 1,
            item_id: line.item_id,
            quantity_paid: line.quantity_paid,
            quantity_free: line.quantity_free,
            unit_price: line.unit_price,
          })),
        );

        if (linesError) throw linesError;

        await supabase.from("invoice_register").insert({
          invoice_no: normalizedInvoiceNo,
          invoice_type: "PURCHASE",
        });
      }
    },
    onSuccess: () => {
      toast.success("تم حفظ فواتير المشتريات بنجاح");
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      setInvoices([]);
    },
    onError: (error: any) => {
      toast.error("خطأ في الحفظ: " + error.message);
    },
  });

  const totals = {
    invoices: invoices.length,
    lines: invoices.reduce((s, inv) => s + inv.lines.length, 0),
    total: invoices.reduce(
      (s, inv) => s + inv.lines.reduce((ss, l) => ss + Number(l.quantity_paid ?? 0) * Number(l.unit_price ?? 0), 0),
      0,
    ),
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6" dir="rtl">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" onClick={() => navigate("/")}
          >
            <ArrowRight className="h-5 w-5" />
          </Button>
          <h1 className="text-3xl font-bold text-slate-900">فواتير المشتريات</h1>
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
          <TabsList className="grid grid-cols-2 w-full max-w-md">
            <TabsTrigger value="excel">استيراد Excel</TabsTrigger>
            <TabsTrigger value="manual">إدخال يدوي</TabsTrigger>
          </TabsList>

          <TabsContent value="excel" className="mt-6">
            <PurchaseExcelImport items={items} suppliers={suppliers} invoices={invoices} onInvoicesChange={setInvoices} />

            {invoices.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>حفظ الفواتير</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
                    <div className="text-sm text-muted-foreground">
                      {totals.invoices} فاتورة | {totals.lines} سطر | الإجمالي: {totals.total.toFixed(3)} د.ك
                    </div>
                    <Button onClick={() => saveImportedMutation.mutate()} disabled={saveImportedMutation.isPending}>
                      {saveImportedMutation.isPending ? "جاري الحفظ..." : "حفظ كل الفواتير"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="manual" className="mt-6">
            <PurchaseManualEntry items={items} suppliers={suppliers} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default PurchaseEntry;
