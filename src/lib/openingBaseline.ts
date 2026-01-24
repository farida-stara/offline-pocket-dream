import { supabase } from "@/integrations/supabase/client";

/**
 * تاريخ الرصيد الافتتاحي الثابت (بداية العمل).
 * يتم أخذه كأقدم entry_date موجود في opening_stock.
 */
export async function fetchOpeningBaselineDate(): Promise<string | null> {
  const { data, error } = await supabase
    .from("opening_stock")
    .select("entry_date")
    .order("entry_date", { ascending: true })
    .limit(1);
  if (error) throw error;

  const d = (data?.[0] as any)?.entry_date;
  return d ? String(d) : null;
}
