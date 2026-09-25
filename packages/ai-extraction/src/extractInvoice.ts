import { extractTextFromPdf } from "./pdfText.js";
import { InvoiceExtraction } from "./schema.js";

/**
 * Provider boundary. Any LLM backend implements this same shape — text in,
 * raw (untrusted) JSON out. Validation against `InvoiceExtraction` happens
 * centrally in `extractInvoiceFromPdf`, never inside a provider, so
 * swapping providers (NVIDIA today, Claude or anything else later) can
 * never accidentally skip the schema check.
 */
export type InvoiceExtractor = (invoiceText: string) => Promise<unknown>;

export async function extractInvoiceFromPdf(
  pdfBuffer: Buffer,
  deps: { extractor: InvoiceExtractor; extractText?: (buffer: Buffer) => Promise<string> },
): Promise<InvoiceExtraction> {
  const extractText = deps.extractText ?? extractTextFromPdf;
  const text = await extractText(pdfBuffer);

  const raw = await deps.extractor(text);

  const parsed = InvoiceExtraction.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `extraction did not match the expected schema: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}
