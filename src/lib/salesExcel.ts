import * as XLSX from "xlsx";
import { normalizeArabic } from "@/lib/fuzzy";

export interface SalesExcelLine {
  itemCode: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  notes?: string;
}

export interface SalesExcelInvoice {
  sheetName: string;
  invoiceNo: string;
  invoiceDate: string;
  customerCode: string;
  customerName: string;
  paymentMethod: string;
  notes: string;
  lines: SalesExcelLine[];
  totalAmount: number;
}

function parseDateCell(val: any): string {
  if (!val) return new Date().toISOString().split("T")[0];
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) {
      const mm = String(d.m).padStart(2, "0");
      const dd = String(d.d).padStart(2, "0");
      return `${d.y}-${mm}-${dd}`;
    }
  }
  const str = String(val).trim();
  const iso = Date.parse(str);
  if (!isNaN(iso)) return new Date(iso).toISOString().split("T")[0];
  return new Date().toISOString().split("T")[0];
}

function normalizeDigits(input: string): string {
  // Arabic-Indic and Eastern Arabic-Indic digits
  const map: Record<string, string> = {
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
    "۰": "0",
    "۱": "1",
    "۲": "2",
    "۳": "3",
    "۴": "4",
    "۵": "5",
    "۶": "6",
    "۷": "7",
    "۸": "8",
    "۹": "9",
  };
  return String(input ?? "").replace(/[٠-٩۰-۹]/g, (d) => map[d] ?? d);
}

function parseNumberCell(val: any): number {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  const s0 = normalizeDigits(String(val ?? "").trim());
  if (!s0) return 0;

  // Normalize decimal separators and remove thousands separators
  // - If we have both "," and "." -> assume comma is thousands.
  // - If we have only "," -> assume comma is decimal.
  const hasComma = s0.includes(",");
  const hasDot = s0.includes(".");
  const s = s0
    .replace(/\s+/g, "")
    .replace(/٬/g, "") // Arabic thousands separator
    .replace(/٫/g, ".") // Arabic decimal separator
    .replace(hasComma && !hasDot ? /,/g : /,/g, hasComma && !hasDot ? "." : "");

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function findHeaderValue(rows: any[][], keywords: string[]): string {
  const normKeys = keywords.map((k) => normalizeArabic(k));

  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < (row.length ?? 0); c++) {
      const cellRaw = String(row[c] ?? "").trim();
      if (!cellRaw) continue;

      const norm = normalizeArabic(cellRaw);
      const hit = normKeys.some((k) => norm.includes(k));
      if (!hit) continue;

      // Same-cell patterns: "رقم الفاتورة: 123" or "Invoice No - 123"
      const splitByColon = cellRaw.split(":");
      if (splitByColon.length > 1) {
        const after = splitByColon.slice(1).join(":").trim();
        if (after) return after;
      }
      const splitByDash = cellRaw.split("-");
      if (splitByDash.length > 1) {
        const after = splitByDash.slice(1).join("-").trim();
        if (after) return after;
      }

      // Next cell
      const next = row[c + 1];
      if (next !== undefined && next !== null && String(next).trim() !== "") {
        return String(next).trim();
      }

      // Below cell (common in formatted templates)
      const below = rows[r + 1]?.[c];
      if (below !== undefined && below !== null && String(below).trim() !== "") {
        return String(below).trim();
      }
    }
  }
  return "";
}

function findTableHeaderRow(rows: any[][]): {
  headerRowIndex: number;
  codeCol: number | null;
  nameCol: number;
  qtyCol: number;
  priceCol: number;
  totalCol: number | null;
} | null {
  const includes = (hay: string | undefined | null, needle: string) => (hay ?? "").includes(needle);
  const candidates = [
    {
      code: ["الكود", "رمز", "رقم الصنف", "item code", "code", "sku"],
      name: [
        "الصنف",
        "البيان",
        "الوصف",
        "اسم الصنف",
        "الاسم",
        "اسم",
        "المنتج",
        "product",
        "item",
        "name",
        "description",
      ],
      // Some templates use quantity variants like: sold/returned/withdrawn columns
      qty: [
        "الكمية",
        "كمية",
        "العدد",
        "مباع",
        "المباع",
        "مبيعات",
        "qty",
        "quantity",
        "sold",
      ],
      price: [
        "السعر",
        "سعر",
        "سعر الوحدة",
        "سعر بيع",
        "price",
        "unit price",
        "unit",
      ],
      total: ["المجموع", "الإجمالي", "الاجمالي", "total", "line total"],
    },
  ];

  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const row = (rows[r] ?? []).map((c) => String(c ?? "").trim());
    if (!row.some(Boolean)) continue;
    const normRow = row.map((c) => normalizeArabic(c));

    for (const cand of candidates) {
      const codeCol = normRow.findIndex((h) => cand.code.some((k) => includes(h, normalizeArabic(k))));
      const nameCol = normRow.findIndex((h) => cand.name.some((k) => includes(h, normalizeArabic(k))));
      const qtyCol = normRow.findIndex((h) => cand.qty.some((k) => includes(h, normalizeArabic(k))));
      const priceCol = normRow.findIndex((h) => cand.price.some((k) => includes(h, normalizeArabic(k))));
      if (nameCol !== -1 && qtyCol !== -1 && priceCol !== -1) {
        const totalCol = normRow.findIndex((h) => cand.total.some((k) => includes(h, normalizeArabic(k))));
        return {
          headerRowIndex: r,
          codeCol: codeCol === -1 ? null : codeCol,
          nameCol,
          qtyCol,
          priceCol,
          totalCol: totalCol === -1 ? null : totalCol,
        };
      }
    }
  }
  return null;
}

function findTableHeaderRowByData(rows: any[][]): {
  headerRowIndex: number;
  codeCol: number | null;
  nameCol: number;
  qtyCol: number;
  priceCol: number;
  totalCol: number | null;
} | null {
  // Heuristic fallback: find 3 adjacent columns that look like (name:string, qty:number, price:number)
  // within the first ~120 rows, to support templates without explicit header labels.
  const maxRows = Math.min(rows.length, 120);
  for (let r = 0; r < maxRows; r++) {
    const row = rows[r] ?? [];
    const maxCols = Math.min(row.length ?? 0, 40);
    for (let c = 0; c < maxCols - 2; c++) {
      const nameRaw = String(row[c] ?? "").trim();
      const qty = parseNumberCell(row[c + 1]);
      const price = parseNumberCell(row[c + 2]);

      // Name should be non-trivial text; qty/price should look present (not both zero)
      const nameLooksValid = nameRaw.length >= 2 && isNaN(Number(nameRaw));
      const numbersLookValid = !(qty === 0 && price === 0);
      if (nameLooksValid && numbersLookValid) {
        return {
          headerRowIndex: r - 1 >= 0 ? r - 1 : r,
          codeCol: null,
          nameCol: c,
          qtyCol: c + 1,
          priceCol: c + 2,
          totalCol: c + 3 < maxCols ? c + 3 : null,
        };
      }
    }
  }
  return null;
}

export function parseSalesExcel(workbook: XLSX.WorkBook): SalesExcelInvoice[] {
  const invoices: SalesExcelInvoice[] = [];
  let autoSeq = 1;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });

    if (rows.length < 3) continue;

    // Extract header info
    let invoiceNo = findHeaderValue(rows, ["رقم الفاتورة", "invoice no", "invoice #", "فاتورة رقم"]);
    const invoiceDate = parseDateCell(findHeaderValue(rows, ["التاريخ", "date", "تاريخ", "invoice date"]));
    const customerCode = findHeaderValue(rows, ["كود العميل", "customer code", "رمز العميل"]);
    const customerName = findHeaderValue(rows, ["العميل", "customer", "اسم العميل", "customer name"]);
    let paymentMethod = findHeaderValue(rows, ["الدفع", "payment", "طريقة الدفع", "payment method"]);
    const notes = findHeaderValue(rows, ["ملاحظات", "notes", "note"]);

    if (!paymentMethod) paymentMethod = "نقد";
    if (!invoiceNo) {
      invoiceNo = `AUTO-${invoiceDate}-${sheetName.replace(/\s+/g, "_")}-${autoSeq++}`;
    }

    // Find table
    const tableMeta = findTableHeaderRow(rows) ?? findTableHeaderRowByData(rows);
    if (!tableMeta) continue;

    const lines: SalesExcelLine[] = [];
    for (let r = tableMeta.headerRowIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((c: any) => !c && c !== 0)) continue;

      const itemCode = tableMeta.codeCol != null ? String(row[tableMeta.codeCol] ?? "").trim() : "";
      const itemName = String(row[tableMeta.nameCol] ?? "").trim();
      const quantity = parseNumberCell(row[tableMeta.qtyCol]);
      const unitPrice = parseNumberCell(row[tableMeta.priceCol]);
      const explicitTotal = tableMeta.totalCol != null ? parseNumberCell(row[tableMeta.totalCol]) : 0;
      const lineTotal = explicitTotal || quantity * unitPrice;

      if (!itemCode && !itemName) continue;
      // Some templates include discounts/returns or totals rows. Skip only fully-empty numeric rows.
      if (quantity === 0 && unitPrice === 0 && explicitTotal === 0) continue;

      lines.push({ itemCode, itemName, quantity, unitPrice, lineTotal });
    }

    if (lines.length === 0) continue;

    const totalAmount = lines.reduce((sum, l) => sum + l.lineTotal, 0);

    invoices.push({
      sheetName,
      invoiceNo,
      invoiceDate,
      customerCode,
      customerName,
      paymentMethod,
      notes,
      lines,
      totalAmount,
    });
  }

  return invoices;
}

export function normalizeSalesInvoiceNo(invoiceNo: string): string {
  const trimmed = invoiceNo.trim();
  if (trimmed.toUpperCase().startsWith("S-")) return trimmed;
  return `S-${trimmed}`;
}
