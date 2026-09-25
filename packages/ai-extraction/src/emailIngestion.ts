import { simpleParser } from "mailparser";
import { extractInvoiceFromPdf, type InvoiceExtractor } from "./extractInvoice.js";
import type { InvoiceExtraction } from "./schema.js";

export type EmailPdfAttachment = { filename: string; content: Buffer };

function isPdfAttachment(a: { contentType: string; filename?: string }): boolean {
  return a.contentType === "application/pdf" || (a.filename?.toLowerCase().endsWith(".pdf") ?? false);
}

/** HU-D2-13: pulls every PDF attachment out of a raw MIME email — the same `.eml` bytes an inbox connector would hand over. */
export async function extractPdfAttachments(rawEmail: Buffer | string): Promise<EmailPdfAttachment[]> {
  const parsed = await simpleParser(rawEmail);
  return parsed.attachments
    .filter(isPdfAttachment)
    .map((a) => ({ filename: a.filename ?? "attachment.pdf", content: a.content }));
}

export type EmailExtractionResult =
  | { status: "EXTRACTED"; filename: string; extraction: InvoiceExtraction }
  | { status: "NO_PDF_ATTACHMENT" }
  | { status: "EXTRACTION_FAILED"; filename: string; error: string };

/**
 * Same pipeline HU-D2-11 already built (`extractInvoiceFromPdf`), just fed
 * from an email's attachment instead of a directly-uploaded PDF — nothing
 * downstream (schema validation, `resolveExtraction`'s guardrail) needs to
 * know or care which one it came from. A multi-invoice email isn't an
 * error: every attached PDF becomes its own result, and one bad attachment
 * doesn't fail the others.
 */
export async function extractInvoicesFromEmail(
  rawEmail: Buffer | string,
  deps: { extractor: InvoiceExtractor; extractText?: (buffer: Buffer) => Promise<string> },
): Promise<EmailExtractionResult[]> {
  const attachments = await extractPdfAttachments(rawEmail);
  if (attachments.length === 0) return [{ status: "NO_PDF_ATTACHMENT" }];

  const results: EmailExtractionResult[] = [];
  for (const attachment of attachments) {
    try {
      const extraction = await extractInvoiceFromPdf(attachment.content, deps);
      results.push({ status: "EXTRACTED", filename: attachment.filename, extraction });
    } catch (err) {
      results.push({ status: "EXTRACTION_FAILED", filename: attachment.filename, error: (err as Error).message });
    }
  }
  return results;
}
