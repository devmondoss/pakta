import { describe, expect, it, vi } from "vitest";
import { extractInvoiceFromPdf } from "../src/extractInvoice.js";

const validExtraction = {
  vendorName: { value: "CloudData Inc.", confidence: 0.98, sourceExcerpt: "Bill to: CloudData Inc." },
  invoiceId: { value: "INV-001", confidence: 0.99, sourceExcerpt: "Invoice #INV-001" },
  amount: { value: "5000.00", confidence: 0.97, sourceExcerpt: "Total: $5,000.00" },
  dueDate: { value: "2026-09-23", confidence: 0.9, sourceExcerpt: "Due 09/23/2026" },
};

describe("extractInvoiceFromPdf", () => {
  it("extracts text from the PDF and hands it to the extractor", async () => {
    const extractText = vi.fn().mockResolvedValue("Invoice text goes here");
    const extractor = vi.fn().mockResolvedValue(validExtraction);

    const result = await extractInvoiceFromPdf(Buffer.from("fake-pdf-bytes"), {
      extractText,
      extractor,
    });

    expect(result).toEqual(validExtraction);
    expect(extractor).toHaveBeenCalledWith("Invoice text goes here");
  });

  it("rejects a provider response that doesn't match the schema — never passes raw model output through", async () => {
    const extractText = vi.fn().mockResolvedValue("Invoice text goes here");
    const extractor = vi.fn().mockResolvedValue({ vendorName: "CloudData Inc." }); // wrong shape, no confidence

    await expect(
      extractInvoiceFromPdf(Buffer.from("fake-pdf-bytes"), { extractText, extractor }),
    ).rejects.toThrow(/did not match the expected schema/);
  });
});
