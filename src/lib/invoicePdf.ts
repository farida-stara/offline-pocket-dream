import pdfMake from "pdfmake/build/pdfmake";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - pdfmake fonts module has no proper TS types
import * as pdfFontsModule from "pdfmake/build/vfs_fonts";

type PdfLine = {
  itemName: string;
  qty: number;
  quantities?: {
    sold: number;
    returned: number;
    withdrawn: number;
  };
  unitPrice: number;
  lineTotal: number;
};

export type PdfInvoice = {
  title: string;
  invoiceNo: string;
  date: string;
  partyLabel: string; // المورد / العميل
  partyName: string;
  paymentMethod?: string;
  notes?: string;
  currency?: string;
  totals: {
    totalAmount: number;
    expectedSellingTotal?: number;
  };
  lines: PdfLine[];
};

function getBuiltinVfs(): Record<string, string> {
  const mod: any = pdfFontsModule as any;
  return (
    mod?.pdfMake?.vfs ||
    mod?.default?.pdfMake?.vfs ||
    mod?.vfs ||
    mod?.default?.vfs ||
    {}
  );
}

function pickAnyExistingVfs(): Record<string, string> {
  for (const t of getPdfMakeTargets()) {
    const v = t?.vfs;
    if (v && typeof v === "object" && Object.keys(v).length) return v;
  }
  return {};
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  // Avoid spread/apply on large arrays (can throw in some browsers)
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x2000; // 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]);
  }
  return btoa(binary);
}

let arabicFontReady: Promise<void> | null = null;

function getPdfMakeTargets(): any[] {
  const t: any[] = [];
  const pm: any = pdfMake as any;
  if (pm) t.push(pm);
  if (pm?.default) t.push(pm.default);
  if (pm?.pdfMake) t.push(pm.pdfMake);
  // de-duplicate
  return Array.from(new Set(t));
}

function setPdfMakeVfs(nextVfs: Record<string, string>) {
  for (const t of getPdfMakeTargets()) {
    t.vfs = nextVfs;
  }
}

function setPdfMakeFonts(nextFonts: any) {
  for (const t of getPdfMakeTargets()) {
    t.fonts = nextFonts;
  }
}

async function ensureArabicFont() {
  if (arabicFontReady) return arabicFontReady;

  arabicFontReady = (async () => {
    // Always start from a known-good VFS.
    // In Vite/ESM, pdfmake can exist behind multiple wrappers; we must set VFS on all of them.
    const builtin = getBuiltinVfs();
    const existing = pickAnyExistingVfs();
    const baseVfs = Object.keys(existing).length ? existing : builtin;
    if (!Object.keys(baseVfs).length) {
      throw new Error("تعذر تهيئة نظام خطوط PDF");
    }
    setPdfMakeVfs(baseVfs);

    // Load font from public/ (so it works in preview + published)
    const res = await fetch("/fonts/Amiri-Regular.ttf");
    if (!res.ok) throw new Error("تعذر تحميل خط الطباعة العربي");
    const buf = await res.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);

    // Add to VFS + register font family
    // Merge into the *current* VFS (already set above), then re-apply to all targets.
    const current = pickAnyExistingVfs();
    const mergedVfs: Record<string, string> = {
      ...(Object.keys(current).length ? current : baseVfs),
      "Amiri-Regular.ttf": base64,
    };
    setPdfMakeVfs(mergedVfs);

    const mergedFonts = {
      ...((pdfMake as any).fonts ?? {}),
      Amiri: {
        normal: "Amiri-Regular.ttf",
        bold: "Amiri-Regular.ttf",
        italics: "Amiri-Regular.ttf",
        bolditalics: "Amiri-Regular.ttf",
      },
    };
    setPdfMakeFonts(mergedFonts);
  })();

  return arabicFontReady;
}

function money(n: number, currency = "د.ك") {
  const v = Number(n || 0);
  return `${v.toFixed(3)} ${currency}`;
}

function invoiceToContent(inv: PdfInvoice) {
  const currency = inv.currency ?? "د.ك";

  const hasQtyBreakdown = (inv.lines ?? []).some((l) => {
    const q = (l as any)?.quantities;
    if (!q) return false;
    return Number(q.sold || 0) !== 0 || Number(q.returned || 0) !== 0 || Number(q.withdrawn || 0) !== 0;
  });

  const headerTableBody = [
    [
      { text: "رقم الفاتورة", style: "label" },
      { text: inv.invoiceNo, style: "value" },
      { text: "التاريخ", style: "label" },
      { text: inv.date, style: "value" },
    ],
    [
      { text: inv.partyLabel, style: "label" },
      { text: inv.partyName, style: "value" },
      { text: "طريقة الدفع", style: "label" },
      { text: inv.paymentMethod || "-", style: "value" },
    ],
  ];

  const linesBody = hasQtyBreakdown
    ? [
        [
          { text: "م", style: "tableHeader" },
          { text: "الصنف", style: "tableHeader" },
          { text: "الكمية المباعه", style: "tableHeader" },
          { text: "مرتجع", style: "tableHeader" },
          { text: "مسحوب", style: "tableHeader" },
          { text: "السعر", style: "tableHeader" },
          { text: "الإجمالي", style: "tableHeader" },
        ],
        ...inv.lines.map((l, idx) => {
          const q = (l as any)?.quantities ?? { sold: l.qty, returned: 0, withdrawn: 0 };
          return [
            { text: String(idx + 1), alignment: "right" },
            { text: l.itemName || "-", alignment: "right" },
            { text: Number(q.sold || 0).toFixed(3), alignment: "right" },
            { text: Number(q.returned || 0).toFixed(3), alignment: "right" },
            { text: Number(q.withdrawn || 0).toFixed(3), alignment: "right" },
            { text: money(l.unitPrice || 0, currency), alignment: "right" },
            { text: money(l.lineTotal || 0, currency), alignment: "right" },
          ];
        }),
      ]
    : [
        [
          { text: "م", style: "tableHeader" },
          { text: "الصنف", style: "tableHeader" },
          { text: "الكمية", style: "tableHeader" },
          { text: "السعر", style: "tableHeader" },
          { text: "الإجمالي", style: "tableHeader" },
        ],
        ...inv.lines.map((l, idx) => [
          { text: String(idx + 1), alignment: "right" },
          { text: l.itemName || "-", alignment: "right" },
          { text: Number(l.qty || 0).toFixed(3), alignment: "right" },
          { text: money(l.unitPrice || 0, currency), alignment: "right" },
          { text: money(l.lineTotal || 0, currency), alignment: "right" },
        ]),
      ];

  const totalsRight = [
    { text: `الإجمالي: ${money(inv.totals.totalAmount, currency)}`, style: "totals" },
  ];
  if (typeof inv.totals.expectedSellingTotal === "number") {
    const diff = Number(inv.totals.expectedSellingTotal) - Number(inv.totals.totalAmount);
    totalsRight.push({
      text: `البيع المتوقع: ${money(inv.totals.expectedSellingTotal, currency)}`,
      style: "totalsMuted",
    });
    totalsRight.push({
      text: `الفرق (المتوقع - الإجمالي): ${money(diff, currency)}`,
      style: "totalsMuted",
    });
  }

  const notesBlock = inv.notes
    ? [{ text: "ملاحظات:", style: "label" }, { text: inv.notes, margin: [0, 2, 0, 0] }]
    : [];

  return [
    { text: inv.title, style: "title" },
    {
      table: {
        widths: ["auto", "*", "auto", "*"],
        body: headerTableBody,
      },
      layout: "lightHorizontalLines",
      margin: [0, 8, 0, 10],
    },
    {
      table: {
        widths: hasQtyBreakdown ? [20, "*", 50, 45, 45, 70, 80] : [20, "*", 60, 70, 80],
        body: linesBody,
      },
      layout: "lightHorizontalLines",
    },
    {
      columns: [
        { width: "*", text: "" },
        { width: "auto", stack: totalsRight, alignment: "right", margin: [0, 10, 0, 0] },
      ],
    },
    ...(notesBlock.length
      ? [{ text: "", margin: [0, 8, 0, 0] }, ...notesBlock]
      : []),
  ];
}

export async function downloadSingleInvoicePdf(inv: PdfInvoice) {
  const pdf = await getSingleInvoicePdf(inv);
  pdf.download(`${inv.invoiceNo}.pdf`);
}

export async function openSingleInvoicePdf(inv: PdfInvoice) {
  const pdf = await getSingleInvoicePdf(inv);
  pdf.open();
}

export async function printSingleInvoicePdf(inv: PdfInvoice) {
  const pdf = await getSingleInvoicePdf(inv);
  pdf.print();
}

export async function getSingleInvoicePdf(inv: PdfInvoice) {
  await ensureArabicFont();

  const docDefinition = {
    pageSize: "A4",
    pageMargins: [32, 28, 32, 28],
    defaultStyle: {
      font: "Amiri",
      fontSize: 11,
      alignment: "right",
    },
    content: invoiceToContent(inv),
    styles: {
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 6] },
      label: { bold: true, color: "#444" },
      value: { color: "#111" },
      tableHeader: { bold: true, fillColor: "#f2f2f2" },
      totals: { bold: true, fontSize: 12 },
      totalsMuted: { color: "#555" },
    },
  };

  return pdfMake.createPdf(docDefinition as any);
}

export async function downloadInvoicesPdf(fileName: string, invoices: PdfInvoice[]) {
  await ensureArabicFont();

  const content: any[] = [];
  invoices.forEach((inv, idx) => {
    content.push(...invoiceToContent(inv));
    if (idx !== invoices.length - 1) content.push({ text: "", pageBreak: "after" });
  });

  const docDefinition = {
    pageSize: "A4",
    pageMargins: [32, 28, 32, 28],
    defaultStyle: {
      font: "Amiri",
      fontSize: 11,
      alignment: "right",
    },
    content,
    styles: {
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 6] },
      label: { bold: true, color: "#444" },
      value: { color: "#111" },
      tableHeader: { bold: true, fillColor: "#f2f2f2" },
      totals: { bold: true, fontSize: 12 },
      totalsMuted: { color: "#555" },
    },
  };

  pdfMake.createPdf(docDefinition as any).download(fileName);
}
