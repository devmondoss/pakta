/**
 * Generates the 3 layout-varied invoice PDFs from demo-invoices.json —
 * HU-D2-11's "≥3 PDFs con distinto layout" fixtures. Run with
 * `pnpm build:pdf-fixtures` and commit the resulting .pdf files.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PDFDocument, PDFFont, StandardFonts } from "pdf-lib";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(path.join(here, "demo-invoices.json"), "utf-8"));

const PAGE_WIDTH = 400;
const MARGIN = 40;
const MAX_LINE_WIDTH = PAGE_WIDTH - MARGIN * 2;

/** pdf-lib doesn't wrap text — a line wider than the page just runs off it and gets silently dropped by text extraction, so wrap by measured width before drawing. */
function wrapLine(line: string, font: PDFFont, fontSize: number): string[] {
  const words = line.split(" ");
  const wrapped: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) > MAX_LINE_WIDTH && current) {
      wrapped.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) wrapped.push(current);
  return wrapped.length > 0 ? wrapped : [""];
}

async function buildOne(file: string, text: string): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([PAGE_WIDTH, 500]);
  const fontSize = 11;
  const lines = text.split("\n").flatMap((line) => wrapLine(line, font, fontSize));

  let y = 460;
  for (const line of lines) {
    page.drawText(line, { x: MARGIN, y, size: fontSize, font });
    y -= fontSize + 6;
  }

  const bytes = await doc.save();
  writeFileSync(path.join(here, file), bytes);
  console.log(`wrote ${file}`);
}

/** A real ruled grid (drawn lines, not whitespace) — proves table detection and total-vs-subtotal disambiguation work on an actually tabular invoice, not just varied text layouts. */
async function buildLineItemsTableInvoice(file: string): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([450, 500]);

  page.drawText("TechSupply Corp - INVOICE INV-3001", { x: 40, y: 460, size: 12, font });
  page.drawText("Bill To: Pakta Inc.", { x: 40, y: 440, size: 10, font });

  const rows = [
    ["Item", "Qty", "Unit Price", "Subtotal"],
    ["Widgets", "10", "45.00", "450.00"],
    ["Installation", "1", "200.00", "200.00"],
  ];
  const colWidths = [140, 60, 90, 90];
  const x0 = 40;
  const yTop = 410;
  const rowHeight = 22;
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  const tableHeight = rowHeight * rows.length;

  for (let i = 0; i <= rows.length; i++) {
    const y = yTop - i * rowHeight;
    page.drawLine({ start: { x: x0, y }, end: { x: x0 + tableWidth, y }, thickness: 1 });
  }
  let cx = x0;
  page.drawLine({ start: { x: cx, y: yTop }, end: { x: cx, y: yTop - tableHeight }, thickness: 1 });
  for (const w of colWidths) {
    cx += w;
    page.drawLine({ start: { x: cx, y: yTop }, end: { x: cx, y: yTop - tableHeight }, thickness: 1 });
  }

  rows.forEach((row, ri) => {
    let tx = x0 + 6;
    row.forEach((cell, ci) => {
      page.drawText(cell, { x: tx, y: yTop - ri * rowHeight - 15, size: 9, font });
      tx += colWidths[ci]!;
    });
  });

  const belowTable = yTop - tableHeight - 25;
  page.drawText("Total Due: 650.00", { x: 40, y: belowTable, size: 11, font });
  page.drawText("PO: PO-99110", { x: 40, y: belowTable - 18, size: 10, font });
  page.drawText("Wallet: GXTEST0000000000000000000", { x: 40, y: belowTable - 36, size: 10, font });
  page.drawText("Due: 2026-11-01", { x: 40, y: belowTable - 54, size: 10, font });

  const bytes = await doc.save();
  writeFileSync(path.join(here, file), bytes);
  console.log(`wrote ${file}`);
}

async function main() {
  for (const invoice of data.invoices) {
    if (invoice.generator === "line-items-table") {
      await buildLineItemsTableInvoice(invoice.file);
    } else {
      await buildOne(invoice.file, invoice.text);
    }
  }
}

main();
