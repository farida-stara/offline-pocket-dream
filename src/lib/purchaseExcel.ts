import * as XLSX from "xlsx";
import { getBestMatchesByKeys, normalizeArabic } from "@/lib/fuzzy";

export type PurchaseImportLine = {
  id: string;
  item_id: string;
  quantity_paid: number;
  quantity_free: number;
  unit_price: number;
  discount_percent: number;
  /** Manual margin override as multiplier (e.g. 1.25). If unset, UI may use invoice margin_percent. */
  margin_factor?: number;
  source_name?: string;
};

export type PurchaseImportInvoice = {
  id: string;
  source_sheet: string;
  invoice_no: string;
  invoice_date: string; // ISO date yyyy-mm-dd
  supplier_id: string;
  supplier_label?: string;
  payment_method?: string;
  payment_status?: string;
  notes?: string;
  margin_percent: number;
  lines: PurchaseImportLine[];
};

type ItemRow = { id: string; item_name?: string | null; item_code?: string | null };
type SupplierRow = { id: string; supplier_name?: string | null; supplier_code?: string | null };

function excelDateToISO(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial date
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const yyyy = String(parsed.y).padStart(4, "0");
    const mm = String(parsed.m).padStart(2, "0");
    const dd = String(parsed.d).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const s = String(value).trim();
  if (!s) return null;

  // ISO-ish
  const isoMatch = s.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (isoMatch) {
    const yyyy = isoMatch[1];
    const mm = String(Number(isoMatch[2])).padStart(2, "0");
    const dd = String(Number(isoMatch[3])).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  // dd/mm/yyyy or dd-mm-yyyy
  const dmyMatch = s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (dmyMatch) {
    const dd = String(Number(dmyMatch[1])).padStart(2, "0");
    const mm = String(Number(dmyMatch[2])).padStart(2, "0");
    const yyyy = dmyMatch[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

function pickNextCellValue(row: any[], colIndex: number): string {
  const v = row?.[colIndex + 1];
  return String(v ?? "").trim();
}

function findHeaderValue(rows: any[][], keys: string[]): string | null {
  const normKeys = keys.map((k) => normalizeArabic(k));

  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] ?? "").trim();
      if (!cell) continue;

      const norm = normalizeArabic(cell);
      const hit = normKeys.some((k) => (norm ?? "").includes(k));
      if (!hit) continue;

      // Try same cell like "Invoice No: 123"
      const afterColon = cell.split(":")[1] ?? cell.split("-")[1];
      if (afterColon && afterColon.trim()) return afterColon.trim();

      // Try next cell
      const next = pickNextCellValue(row, c);
      if (next) return next;
    }
  }

  return null;
}

function autoInvoiceNo(sheetName: string, dateIso: string | null, index: number) {
  const d = dateIso ?? new Date().toISOString().slice(0, 10);
  const safeSheet = sheetName.replace(/\s+/g, "_").slice(0, 20);
  return `AUTO-${d}-${safeSheet}-${index + 1}`;
}

function normalizePurchaseInvoiceNo(raw: string): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  // keep if already has prefix (P- or any letters)
  if (/^[a-zA-Z]+-/.test(v)) return v;
  return `P-${v}`;
}

function findTableHeaderRow(rows: any[][]) {
  const includes = (hay: string | undefined | null, needle: string) => (hay ?? "").includes(needle);
  const candidates = [
    // Arabic
    {
      item: ["الصنف", "النوع", "اسم"],
      qty: ["الكمية", "عدد"],
      price: ["السعر", "التكلفة", "سعر"],
      discount: ["خصم", "نسبة الخصم", "%"],
    },
    // English
    {
      item: ["item", "description", "name"],
      qty: ["qty", "quantity"],
      price: ["price", "cost", "unit"],
      discount: ["discount", "%"],
    },
  ];

  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const row = (rows[r] ?? []).map((c) => String(c ?? "").trim());
    if (!row.some(Boolean)) continue;

    const normRow = row.map((c) => normalizeArabic(c));

    for (const cand of candidates) {
      const colItem = normRow.findIndex((h) => cand.item.some((k) => includes(h, normalizeArabic(k))));
      const colQty = normRow.findIndex((h) => cand.qty.some((k) => includes(h, normalizeArabic(k))));
      const colPrice = normRow.findIndex((h) => cand.price.some((k) => includes(h, normalizeArabic(k))));

      if (colItem !== -1 && colQty !== -1 && colPrice !== -1) {
        const colDiscount = normRow.findIndex((h) => cand.discount.some((k) => includes(h, normalizeArabic(k))));
        return { headerRowIndex: r, colItem, colQty, colPrice, colDiscount: colDiscount === -1 ? null : colDiscount };
      }
    }
  }

  return null;
}

export function parsePurchaseWorkbook(args: {
  buf: ArrayBuffer;
  items: ItemRow[] | undefined;
  suppliers: SupplierRow[] | undefined;
  defaultMarginPercent?: number;
}): PurchaseImportInvoice[] {
  const { buf, items, suppliers, defaultMarginPercent = 0 } = args;

  const itemsIndex = new Map<string, string>();
  const itemsByCode = new Map<string, string>();
  (items ?? []).forEach((it) => {
    if (it.item_name) itemsIndex.set(normalizeArabic(it.item_name), it.id);
    if (it.item_code) itemsByCode.set(normalizeArabic(it.item_code), it.id);
  });

  const suppliersByName = new Map<string, string>();
  const suppliersByCode = new Map<string, string>();
  (suppliers ?? []).forEach((s) => {
    if (s.supplier_name) suppliersByName.set(normalizeArabic(s.supplier_name), s.id);
    if (s.supplier_code) suppliersByCode.set(normalizeArabic(s.supplier_code), s.id);
  });

  const wb = XLSX.read(buf, { type: "array" });

  const invoices: PurchaseImportInvoice[] = [];

  wb.SheetNames.forEach((sheetName, sheetIndex) => {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return;

    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: true });

    const rawInvoiceNo = findHeaderValue(rows, ["رقم الفاتورة", "فاتورة", "invoice no", "invoice #", "invoice"]);
    const rawSupplier = findHeaderValue(rows, [
      "المورد",
      "اسم المورد",
      "المورد/المزود",
      "المزود",
      "شركة",
      "supplier",
      "vendor",
      "vendor name",
      "supplier name",
    ]);
    const rawDate = findHeaderValue(rows, ["تاريخ", "تاريخ الفاتورة", "date", "invoice date"]);
    const rawPayment = findHeaderValue(rows, ["طريقة الدفع", "الدفع", "payment method", "payment"]);
    const rawStatus = findHeaderValue(rows, ["حالة الدفع", "الحالة", "payment status", "status"]);

    const invoiceDate = excelDateToISO(rawDate) ?? new Date().toISOString().slice(0, 10);

    let invoiceNo = rawInvoiceNo?.trim() || autoInvoiceNo(sheetName, invoiceDate, sheetIndex);
    invoiceNo = normalizePurchaseInvoiceNo(invoiceNo);

    const supplierNorm = normalizeArabic(String(rawSupplier ?? ""));
    const supplierId =
      suppliersByCode.get(supplierNorm) ||
      suppliersByName.get(supplierNorm) ||
      (() => {
        const best = getBestMatchesByKeys(rawSupplier ?? "", suppliers, { name: "supplier_name", code: "supplier_code" }, 1)[0];
        // be conservative to avoid wrong vendor assignment
        return best && best.score >= 0.75 ? best.id : "";
      })();

    const tableMeta = findTableHeaderRow(rows);
    const lines: PurchaseImportLine[] = [];

    if (tableMeta) {
      const dataRows = rows.slice(tableMeta.headerRowIndex + 1);

      // Enforce: duplicate rows are only allowed for "free items" lines.
      // For normal lines, we merge duplicates by (item, unit price).
      const mergedNonFree = new Map<
        string,
        {
          id: string;
          item_id: string;
          quantity_paid: number;
          quantity_free: number;
          unit_price: number;
          discount_percent: number;
          source_name?: string;
        }
      >();

      for (const r of dataRows) {
        const nameRaw = String(r?.[tableMeta.colItem] ?? "").trim();
        if (!nameRaw) continue;

        const qtyPaid = Number(r?.[tableMeta.colQty] ?? 0);
        // IMPORTANT: The purchase "price/cost" column is treated as UNIT PRICE.
        // We store it exactly as entered (no redistribution across free qty).
        const unitPrice = Number(r?.[tableMeta.colPrice] ?? 0);
        const discountPercent =
          tableMeta.colDiscount != null && tableMeta.colDiscount >= 0
            ? Number(r?.[tableMeta.colDiscount] ?? 0)
            : 0;

        if (!Number.isFinite(qtyPaid) || !Number.isFinite(unitPrice) || !Number.isFinite(discountPercent)) continue;

        // Free item rule (ONLY reason to allow duplicate rows):
        // quantity has value + purchase price is zero.
        const isFreeItemRow = qtyPaid > 0 && unitPrice === 0;

        // Skip invalid rows
        if (qtyPaid <= 0) continue;
        if (!isFreeItemRow && unitPrice <= 0) continue;

        // Optional discount% (applies ONLY to the value/total). Clamp to [0..100]
        const safeDiscount = Math.max(0, Math.min(100, Number.isFinite(discountPercent) ? discountPercent : 0));

        const key = normalizeArabic(nameRaw);
        const matched = itemsByCode.get(key) || itemsIndex.get(key);

        // When row is free-item (qty>0 and price=0), we store it as a separate line:
        // paid quantity becomes 0, and free quantity holds the qty from the Excel "qty" column.
        if (isFreeItemRow) {
          lines.push({
            id: crypto.randomUUID(),
            item_id: matched ?? "",
            quantity_paid: 0,
            quantity_free: qtyPaid,
            unit_price: 0,
            discount_percent: 0,
            source_name: nameRaw,
          });
          continue;
        }

        // Normal (non-free) row: merge duplicates so duplicates only remain for free-item rows.
        const dedupeKey = `${matched ?? ""}::${key}::${unitPrice}::${safeDiscount}`;
        const existing = mergedNonFree.get(dedupeKey);
        if (existing) {
          existing.quantity_paid += qtyPaid;
        } else {
          mergedNonFree.set(dedupeKey, {
            id: crypto.randomUUID(),
            item_id: matched ?? "",
            quantity_paid: qtyPaid,
            quantity_free: 0,
            unit_price: unitPrice,
            discount_percent: safeDiscount,
            source_name: nameRaw,
          });
        }
      }

      lines.push(...Array.from(mergedNonFree.values()));
    }

    // If empty sheet or couldn't parse line items, skip.
    if (!lines.length) return;

    invoices.push({
      id: crypto.randomUUID(),
      source_sheet: sheetName,
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      supplier_id: supplierId,
      supplier_label: rawSupplier ? String(rawSupplier) : undefined,
      payment_method: rawPayment ? String(rawPayment) : "cash",
      payment_status: rawStatus ? String(rawStatus) : undefined,
      notes: undefined,
      margin_percent: defaultMarginPercent,
      lines,
    });
  });

  return invoices;
}
