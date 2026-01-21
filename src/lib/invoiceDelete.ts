import { supabase } from "@/integrations/supabase/client";

export type InvoiceType = "PURCHASE" | "SALES";

type DeleteInvoiceInput = {
  id: string;
  invoiceNo: string;
  type: InvoiceType;
};

export async function deleteInvoice({ id, invoiceNo, type }: DeleteInvoiceInput) {
  if (type === "PURCHASE") {
    const { error: delLinesError } = await supabase
      .from("purchase_lines")
      .delete()
      .eq("purchase_header_id", id);
    if (delLinesError) throw delLinesError;

    const { error: delHeaderError } = await supabase
      .from("purchase_headers")
      .delete()
      .eq("id", id);
    if (delHeaderError) throw delHeaderError;
  } else {
    const { error: delLinesError } = await supabase
      .from("sales_lines")
      .delete()
      .eq("sales_header_id", id);
    if (delLinesError) throw delLinesError;

    const { error: delHeaderError } = await supabase
      .from("sales_headers")
      .delete()
      .eq("id", id);
    if (delHeaderError) throw delHeaderError;
  }

  // Keep invoice numbers reusable and keep duplicate-check accurate.
  const { error: delRegisterError } = await supabase
    .from("invoice_register")
    .delete()
    .eq("invoice_no", invoiceNo)
    .eq("invoice_type", type);
  if (delRegisterError) throw delRegisterError;
}
