import { supabase } from "@/integrations/supabase/client";

/**
 * Check if invoice numbers already exist in the database
 * Returns array of duplicate invoice numbers
 */
export async function checkDuplicateInvoices(
  invoiceNumbers: string[],
  type: "PURCHASE" | "SALES"
): Promise<string[]> {
  if (!invoiceNumbers.length) return [];

  const { data, error } = await supabase
    .from("invoice_register")
    .select("invoice_no")
    .eq("invoice_type", type)
    .in("invoice_no", invoiceNumbers);

  if (error) {
    console.error("Error checking duplicates:", error);
    return [];
  }

  return data?.map((r) => r.invoice_no) ?? [];
}

/**
 * Check if a single invoice number exists
 */
export async function isInvoiceDuplicate(
  invoiceNo: string,
  type: "PURCHASE" | "SALES"
): Promise<boolean> {
  const duplicates = await checkDuplicateInvoices([invoiceNo], type);
  return duplicates.length > 0;
}
