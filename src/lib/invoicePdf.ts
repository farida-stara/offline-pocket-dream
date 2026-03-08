// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - pdfmake types are complex
import * as pdfMakeModule from "pdfmake/build/pdfmake";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - pdfmake fonts module has no proper TS types
import * as pdfFontsModule from "pdfmake/build/vfs_fonts";

// Get the actual pdfMake instance - handle various Vite/ESM wrapping patterns
const pdfMake: any = (pdfMakeModule as any)?.default || (pdfMakeModule as any)?.pdfMake || pdfMakeModule;

// Initialize VFS from pdfFonts module
const initVfs = (): Record<string, string> => {
  const mod: any = pdfFontsModule as any;
  return (
    mod?.pdfMake?.vfs ||
    mod?.default?.pdfMake?.vfs ||
    mod?.vfs ||
    mod?.default?.vfs ||
    {}
  );
};

// Set initial VFS
if (pdfMake && !pdfMake.vfs) {
  pdfMake.vfs = initVfs();
}

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

async function getBuiltinVfsAsync(): Promise<Record<string, string>> {
  const direct = initVfs();
  if (Object.keys(direct).length) return direct;

  // Vite/ESM can sometimes wrap/optimize CommonJS in a way that makes the static import
  // appear empty at runtime. A dynamic import often yields the correct shape.
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const dyn: any = await import("pdfmake/build/vfs_fonts");
    return (
      dyn?.pdfMake?.vfs ||
      dyn?.default?.pdfMake?.vfs ||
      dyn?.vfs ||
      dyn?.default?.vfs ||
      {}
    );
  } catch {
    return {};
  }
}

// Cached VFS and fonts to apply before every createPdf call
let cachedVfs: Record<string, string> = {};
let cachedFonts: any = {};

function updateVfsCache(vfs: Record<string, string>) {
  cachedVfs = { ...vfs };
}

function updateFontsCache(fonts: any) {
  cachedFonts = { ...fonts };
}

function pickAnyExistingVfs(): Record<string, string> {
  // Check the main pdfMake instance first
  if (pdfMake?.vfs && Object.keys(pdfMake.vfs).length) {
    return pdfMake.vfs;
  }
  // Also check cached
  if (Object.keys(cachedVfs).length) {
    return cachedVfs;
  }
  return {};
}

let arabicFontReady: Promise<void> | null = null;

export type ArabicPdfFontHealth =
  | {
      ok: true;
      fontUrl: string;
      vfsHasFont: boolean;
      targets: number;
    }
  | {
      ok: false;
      fontUrl: string;
      errorMessage: string;
      vfsHasFont: boolean;
      targets: number;
    };


function getPdfMakeTargets(): any[] {
  // IMPORTANT: Avoid circular calls with getPdfMakeInstance().
  const t: any[] = [];
  const pm: any = pdfMake as any;
  if (pm) t.push(pm);
  if (pm?.default) t.push(pm.default);
  if (pm?.pdfMake) t.push(pm.pdfMake);
  if (pm?.default?.pdfMake) t.push(pm.default.pdfMake);
  const globalPm: any = (globalThis as any)?.pdfMake;
  if (globalPm) t.push(globalPm);
  const windowPm: any = typeof window !== "undefined" ? (window as any)?.pdfMake : null;
  if (windowPm) t.push(windowPm);

  // Add the chosen instance too (if different), but WITHOUT creating recursion.
  const inst = getPdfMakeInstanceRaw();
  if (inst) t.push(inst);

  // de-duplicate
  return Array.from(new Set(t.filter(Boolean)));
}

function setPdfMakeVfs(nextVfs: Record<string, string>) {
  // Cache for later use in getPdfMakeInstance
  updateVfsCache(nextVfs);
  
  for (const t of getPdfMakeTargets()) {
    t.vfs = nextVfs;
  }
  // Also set on the raw import directly
  const pm: any = pdfMake as any;
  if (pm) pm.vfs = nextVfs;
  if (pm?.default) pm.default.vfs = nextVfs;
  if (pm?.pdfMake) pm.pdfMake.vfs = nextVfs;
  if (pm?.default?.pdfMake) pm.default.pdfMake.vfs = nextVfs;
}

function setPdfMakeFonts(nextFonts: any) {
  // Cache for later use in getPdfMakeInstance
  updateFontsCache(nextFonts);
  
  for (const t of getPdfMakeTargets()) {
    t.fonts = nextFonts;
  }
  // Also set on the raw import directly
  const pm: any = pdfMake as any;
  if (pm) pm.fonts = nextFonts;
  if (pm?.default) pm.default.fonts = nextFonts;
  if (pm?.pdfMake) pm.pdfMake.fonts = nextFonts;
  if (pm?.default?.pdfMake) pm.default.pdfMake.fonts = nextFonts;
}

function getPdfMakeInstanceRaw(): any {
  // Raw instance finder - no VFS/fonts application
  const pm: any = pdfMake as any;
  const globalPm: any = (globalThis as any)?.pdfMake;
  const windowPm: any = typeof window !== "undefined" ? (window as any)?.pdfMake : null;

  const candidates = [
    pm,
    pm?.default,
    pm?.pdfMake,
    pm?.default?.pdfMake,
    globalPm,
    windowPm,
  ].filter(Boolean);
  
  return candidates.find((t) => typeof t?.createPdf === "function") || pm;
}

function getPdfMakeInstance(): any {
  const instance = getPdfMakeInstanceRaw();
  
  // CRITICAL: Apply cached VFS and fonts directly to the instance before returning
  // This ensures the instance used for createPdf has the font data
  if (instance && Object.keys(cachedVfs).length) {
    instance.vfs = { ...cachedVfs };
  }
  if (instance && Object.keys(cachedFonts).length) {
    instance.fonts = { ...cachedFonts };
  }
  
  return instance;
}

async function ensureArabicFont() {
  if (arabicFontReady) return arabicFontReady;

  arabicFontReady = (async () => {
    try {
    // Always start from a known-good VFS.
    // In Vite/ESM, pdfmake can exist behind multiple wrappers; we must set VFS on all of them.
    const builtin = await getBuiltinVfsAsync();
    const existing = pickAnyExistingVfs();
    // IMPORTANT: Some builds return an empty builtin VFS (Vite/ESM wrapping).
    // We do NOT need the builtin fonts at all as long as we register Amiri into VFS.
    const baseVfs = Object.keys(existing).length
      ? existing
      : Object.keys(builtin).length
        ? builtin
        : {};
    setPdfMakeVfs(baseVfs);

    // Load font from public/ (works with non-root BASE_URL too)
    const fontUrl = `${import.meta.env.BASE_URL}fonts/Amiri-Regular.ttf`;
    const res = await fetch(fontUrl);
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error("Failed to fetch Amiri font", { fontUrl, status: res.status, statusText: res.statusText });
      throw new Error(`تعذر تحميل خط الطباعة العربي (HTTP ${res.status})`);
    }
    const buf = await res.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);

    // Add to VFS + register font family
    // We can start from an empty VFS; only Amiri is required for our PDFs.
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
    } catch (e) {
      // IMPORTANT: If initialization fails once, do not cache the failure.
      // Reset so the next attempt can retry (helps with transient fetch/VFS issues and HMR).
      arabicFontReady = null;
      throw e;
    }
  })();

  return arabicFontReady;
}

export function resetArabicPdfFont() {
  // Allow explicit retry from UI.
  arabicFontReady = null;
}

export async function checkArabicPdfFontHealth(): Promise<ArabicPdfFontHealth> {
  const fontUrl = `${import.meta.env.BASE_URL}fonts/Amiri-Regular.ttf`;
  try {
    await ensureArabicFont();

    // Smoke-test: actually build a tiny PDF using Amiri.
    const pm = getPdfMakeInstance();
    const testDoc = {
      pageSize: "A6",
      pageMargins: [18, 18, 18, 18],
      defaultStyle: { font: "Amiri", fontSize: 12, alignment: "right" },
      content: [{ text: "اختبار PDF" }],
    };
    const pdf = pm.createPdf(testDoc as any);
    await new Promise<void>((resolve, reject) => {
      try {
        pdf.getBase64(
          () => resolve(),
          (err: any) => reject(err),
        );
      } catch (err) {
        reject(err);
      }
    });

    const targets = getPdfMakeTargets();
    const vfs = pickAnyExistingVfs();
    const vfsHasFont = Boolean(vfs?.["Amiri-Regular.ttf"]);
    return {
      ok: true,
      fontUrl,
      vfsHasFont,
      targets: targets.length,
    };
  } catch (e: any) {
    const targets = getPdfMakeTargets();
    const vfs = pickAnyExistingVfs();
    const vfsHasFont = Boolean(vfs?.["Amiri-Regular.ttf"]);
    return {
      ok: false,
      fontUrl,
      errorMessage: String(e?.message || e || "Unknown error"),
      vfsHasFont,
      targets: targets.length,
    };
  }
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
  const blob = await getSingleInvoicePdfBlob(inv);
  openPdfBlobInWindow(blob, { mode: "preview" });
}

export async function printSingleInvoicePdf(inv: PdfInvoice, targetWindow?: Window) {
  const blob = await getSingleInvoicePdfBlob(inv);
  openPdfBlobInWindow(blob, { mode: "print", targetWindow });
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

  const pm = getPdfMakeInstance();
  return pm.createPdf(docDefinition as any);
}

function pdfToBlob(pdf: any): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    try {
      pdf.getBlob(
        (blob: Blob) => resolve(blob),
        (err: any) => reject(err),
      );
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Open a popup window synchronously from the click handler,
 * then pass it to print/open helpers to avoid popup blockers.
 */
export function openPdfWindow(): Window | null {
  if (typeof window === "undefined") return null;
  return window.open("", "_blank");
}

/**
 * Generate a Blob for an invoice PDF.
 * Useful when you need to render/print in a window opened synchronously (to avoid popup blockers).
 */
export async function getSingleInvoicePdfBlob(inv: PdfInvoice): Promise<Blob> {
  const pdf = await getSingleInvoicePdf(inv);
  return pdfToBlob(pdf);
}

type OpenPdfBlobOptions = {
  mode?: "preview" | "print";
  targetWindow?: Window;
  revokeAfterMs?: number;
};

export function openPdfBlobInWindow(blob: Blob, options: OpenPdfBlobOptions = {}): Window {
  const { mode = "preview", targetWindow, revokeAfterMs = 120_000 } = options;
  const win = targetWindow ?? openPdfWindow();
  if (!win) {
    throw new Error("تعذر فتح نافذة PDF. الرجاء السماح بالنوافذ المنبثقة ثم إعادة المحاولة.");
  }

  const url = URL.createObjectURL(blob);

  if (mode === "print") {
    // Write an HTML page that embeds the PDF and auto-prints once loaded.
    // This is far more reliable than listening for `load` on a blob-URL navigation.
    win.document.open();
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head><title>طباعة</title></head>
      <body style="margin:0">
        <embed src="${url}" type="application/pdf" width="100%" height="100%" style="position:fixed;top:0;left:0;width:100%;height:100%;" />
        <script>
          // Give the PDF viewer time to render, then trigger print
          setTimeout(function() {
            window.focus();
            window.print();
          }, 600);
        </script>
      </body>
      </html>
    `);
    win.document.close();
  } else {
    win.location.href = url;
  }

  setTimeout(() => URL.revokeObjectURL(url), revokeAfterMs);
  return win;
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

  const pm = getPdfMakeInstance();
  pm.createPdf(docDefinition as any).download(fileName);
}
