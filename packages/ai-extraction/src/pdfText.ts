import { PDFParse } from "pdf-parse";
import type { TableArray } from "pdf-parse";

function escapeCell(cell: string): string {
  return cell.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** Plain data transform, no AI involved — same principle as the flowing text: a deterministic algorithm does the reformatting, the model only ever reads the result. */
export function tableToMarkdown(rows: TableArray): string {
  if (rows.length === 0) return "";
  const [header, ...body] = rows;
  const cells = (r: string[]) => `| ${r.map(escapeCell).join(" | ")} |`;

  return [cells(header!), `| ${header!.map(() => "---").join(" | ")} |`, ...body.map(cells)].join("\n");
}

/**
 * Text-first, not vision-first — NIM chat models read text, not raw PDF
 * bytes. Real invoices aren't guaranteed to be a flat list of labeled
 * fields: line-item tables are common, and flattening a ruled table into
 * plain text can scramble which number belongs to which row. `getTable()`
 * detects actual grid/ruled tables (via the PDF's vector drawing
 * operators, not guesswork) and those get rendered as Markdown tables and
 * appended — still zero AI tokens spent on the conversion itself, only on
 * reading the result. Invoices with no ruled tables (the common case,
 * validated against 3 real layouts) are completely unaffected.
 */
export async function extractTextFromPdf(pdfBuffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    // Sequential, not Promise.all: concurrent getText()/getTable() calls on
    // the same PDFParse instance race on its internal worker and can throw
    // (observed: a DataCloneError from pdfjs-dist's structured-clone
    // transfer) — each call is cheap enough alone that this costs nothing.
    const textResult = await parser.getText();
    const tableResult = await parser.getTable();

    const tablesMarkdown = tableResult.mergedTables
      .filter((table) => table.length > 0)
      .map(tableToMarkdown)
      .join("\n\n");

    return tablesMarkdown ? `${textResult.text}\n\n## Detected tables\n\n${tablesMarkdown}` : textResult.text;
  } finally {
    await parser.destroy();
  }
}
