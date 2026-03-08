# EnsurePrintLogicRule — Global Print vs Download Separation

## Purpose
Ensure that **print actions** always open the browser's native print dialog directly, and **download actions** always trigger a file download. Never mix the two.

## Rule

### 1. Print Logic (user clicks "طباعة" / "Print")
- **Always** open a blank window **synchronously** in the click handler to bypass popup blockers:
  ```ts
  const win = openPdfWindow(); // from @/lib/invoicePdf
  ```
- Generate the PDF blob asynchronously, then use:
  ```ts
  await printSingleInvoicePdf(payload, win);
  // OR for manual control:
  const blob = await getSingleInvoicePdfBlob(payload);
  openPdfBlobInWindow(blob, { mode: "print", targetWindow: win });
  ```
- The `openPdfBlobInWindow` helper binds `win.addEventListener("load", ...)` **before** setting `win.location.href`, ensuring `print()` fires reliably.

### 2. Download Logic (user clicks "تحميل PDF" / "Download")
- Use `downloadSingleInvoicePdf(payload)` which calls `pdf.download(...)`.
- **Never** call download functions inside print handlers.

### 3. Preview Logic (user clicks "معاينة" / "Preview")
- Open window synchronously, then:
  ```ts
  const blob = await getSingleInvoicePdfBlob(payload);
  openPdfBlobInWindow(blob, { mode: "preview", targetWindow: win });
  ```

### 4. Bulk PDF Export
- Use `downloadInvoicesPdf(fileName, invoices)` for multi-invoice downloads.
- For bulk print, generate a combined blob and use `openPdfBlobInWindow` with `mode: "print"`.

## Prohibited Patterns
- ❌ Calling `downloadSingleInvoicePdf()` inside a print handler
- ❌ Setting `win.location.href = url` without first binding `load` event (use `openPdfBlobInWindow` instead)
- ❌ Opening windows asynchronously (after `await`) — always open synchronously first

## Canonical Helpers (from `@/lib/invoicePdf`)
| Helper | Use Case |
|---|---|
| `openPdfWindow()` | Open blank tab synchronously (call in click handler) |
| `downloadSingleInvoicePdf(inv)` | Download a single invoice PDF |
| `printSingleInvoicePdf(inv, win?)` | Print a single invoice (opens print dialog) |
| `openSingleInvoicePdf(inv)` | Preview a single invoice in new tab |
| `getSingleInvoicePdfBlob(inv)` | Get raw Blob for manual window handling |
| `openPdfBlobInWindow(blob, opts)` | Render blob in window with print/preview mode |
| `downloadInvoicesPdf(name, invs)` | Download multiple invoices as one PDF |

## Applies To
All pages and components that generate or display PDF invoices, including but not limited to:
- `SalesList.tsx`, `SalesDetails.tsx`
- `PurchasesList.tsx`, `PurchaseDetails.tsx`
- `WastageList.tsx`, `WastageDetails.tsx`
- Any future page with print/download/preview PDF functionality
