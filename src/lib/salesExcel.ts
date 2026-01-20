import * as XLSX from "xlsx";

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

function findHeader(rows: any[][], keywords: string[]): string {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    for (let c = 0; c < (rows[r]?.length ?? 0); c++) {
      const cell = String(rows[r][c] ?? "").toLowerCase();
      for (const kw of keywords) {
        if (cell.includes(kw.toLowerCase())) {
          const nextCell = rows[r][c + 1];
          if (nextCell !== undefined && nextCell !== null && nextCell !== "") {
            return String(nextCell).trim();
          }
        }
      }
    }
  }
  return "";
}

function findTableStart(rows: any[][]): number {
  const tableKeywords = ["الصنف", "الكود", "item", "code", "المنتج", "product", "اسم"];
  for (let r = 0; r < rows.length; r++) {
    const rowStr = (rows[r] ?? []).map((c) => String(c ?? "").toLowerCase()).join(" ");
    for (const kw of tableKeywords) {
      if (rowStr.includes(kw.toLowerCase())) return r;
    }
  }
  return 5;
}

function guessColumnIndex(headerRow: any[], keywords: string[]): number {
  for (let c = 0; c < headerRow.length; c++) {
    const cell = String(headerRow[c] ?? "").toLowerCase();
    for (const kw of keywords) {
      if (cell.includes(kw.toLowerCase())) return c;
    }
  }
  return -1;
}

export function parseSalesExcel(workbook: XLSX.WorkBook): SalesExcelInvoice[] {
  const invoices: SalesExcelInvoice[] = [];
  let autoSeq = 1;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    if (rows.length < 3) continue;

    // Extract header info
    let invoiceNo = findHeader(rows, ["رقم الفاتورة", "invoice no", "invoice #", "فاتورة رقم", "رقم"]);
    const invoiceDate = parseDateCell(findHeader(rows, ["التاريخ", "date", "تاريخ"]));
    const customerCode = findHeader(rows, ["كود العميل", "customer code", "رمز العميل"]);
    const customerName = findHeader(rows, ["العميل", "customer", "اسم العميل", "customer name"]);
    let paymentMethod = findHeader(rows, ["الدفع", "payment", "طريقة الدفع", "payment method"]);
    const notes = findHeader(rows, ["ملاحظات", "notes", "note"]);

    if (!paymentMethod) paymentMethod = "نقد";
    if (!invoiceNo) {
      invoiceNo = `AUTO-${invoiceDate}-${sheetName.replace(/\s+/g, "_")}-${autoSeq++}`;
    }

    // Find table
    const tableStart = findTableStart(rows);
    const headerRow = rows[tableStart] ?? [];
    const codeCol = guessColumnIndex(headerRow, ["الكود", "code", "رمز", "item code"]);
    const nameCol = guessColumnIndex(headerRow, ["الصنف", "الاسم", "item", "name", "المنتج", "product"]);
    const qtyCol = guessColumnIndex(headerRow, ["الكمية", "qty", "quantity", "كمية"]);
    const priceCol = guessColumnIndex(headerRow, ["السعر", "price", "unit price", "سعر"]);
    const totalCol = guessColumnIndex(headerRow, ["المجموع", "total", "الإجمالي", "line total"]);

    const lines: SalesExcelLine[] = [];
    for (let r = tableStart + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((c: any) => !c && c !== 0)) continue;

      const itemCode = codeCol >= 0 ? String(row[codeCol] ?? "").trim() : "";
      const itemName = nameCol >= 0 ? String(row[nameCol] ?? "").trim() : "";
      const quantity = qtyCol >= 0 ? parseFloat(row[qtyCol]) || 0 : 0;
      const unitPrice = priceCol >= 0 ? parseFloat(row[priceCol]) || 0 : 0;
      const lineTotal = totalCol >= 0 ? parseFloat(row[totalCol]) || quantity * unitPrice : quantity * unitPrice;

      if (!itemCode && !itemName) continue;
      if (quantity === 0) continue;

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
