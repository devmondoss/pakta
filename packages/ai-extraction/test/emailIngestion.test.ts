import { describe, expect, it, vi } from "vitest";
import { extractInvoicesFromEmail, extractPdfAttachments } from "../src/emailIngestion.js";

const validExtraction = {
  vendorName: { value: "CloudData Inc.", confidence: 0.98, sourceExcerpt: "Bill to: CloudData Inc." },
  invoiceId: { value: "INV-001", confidence: 0.99, sourceExcerpt: "Invoice #INV-001" },
  amount: { value: "5000.00", confidence: 0.97, sourceExcerpt: "Total: $5,000.00" },
  dueDate: { value: "2026-09-23", confidence: 0.9, sourceExcerpt: "Due 09/23/2026" },
};

function rawEmail(attachments: { filename: string; content: string; contentType?: string }[]): string {
  const boundary = "PAKTA-TEST-BOUNDARY";
  const parts = [
    `From: vendor@example.com`,
    `To: ap@pakta.demo`,
    `Subject: Invoice attached`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain`,
    ``,
    `Please find the attached invoice.`,
    ``,
  ];
  for (const a of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${a.contentType ?? "application/pdf"}; name="${a.filename}"`,
      `Content-Disposition: attachment; filename="${a.filename}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      Buffer.from(a.content).toString("base64"),
      ``,
    );
  }
  parts.push(`--${boundary}--`, ``);
  return parts.join("\r\n");
}

describe("extractPdfAttachments", () => {
  it("finds a PDF attachment by content-type", async () => {
    const email = rawEmail([{ filename: "invoice.pdf", content: "fake-pdf-bytes" }]);
    const attachments = await extractPdfAttachments(email);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ filename: "invoice.pdf" });
    expect(attachments[0]!.content.toString()).toBe("fake-pdf-bytes");
  });

  it("ignores non-PDF attachments", async () => {
    const email = rawEmail([{ filename: "readme.txt", content: "not a pdf", contentType: "text/plain" }]);
    expect(await extractPdfAttachments(email)).toHaveLength(0);
  });

  it("finds every PDF when an email has more than one invoice attached", async () => {
    const email = rawEmail([
      { filename: "invoice-1.pdf", content: "pdf one" },
      { filename: "invoice-2.pdf", content: "pdf two" },
    ]);
    const attachments = await extractPdfAttachments(email);
    expect(attachments.map((a) => a.filename)).toEqual(["invoice-1.pdf", "invoice-2.pdf"]);
  });
});

describe("extractInvoicesFromEmail", () => {
  it("runs the same extraction pipeline HU-D2-11 uses, fed from the email's PDF attachment", async () => {
    const email = rawEmail([{ filename: "invoice.pdf", content: "fake-pdf-bytes" }]);
    const extractText = vi.fn().mockResolvedValue("Invoice text goes here");
    const extractor = vi.fn().mockResolvedValue(validExtraction);

    const results = await extractInvoicesFromEmail(email, { extractText, extractor });

    expect(results).toEqual([{ status: "EXTRACTED", filename: "invoice.pdf", extraction: validExtraction }]);
    expect(extractor).toHaveBeenCalledWith("Invoice text goes here");
  });

  it("reports NO_PDF_ATTACHMENT for a plain-text email", async () => {
    const email = rawEmail([]);
    const results = await extractInvoicesFromEmail(email, {
      extractText: vi.fn(),
      extractor: vi.fn(),
    });
    expect(results).toEqual([{ status: "NO_PDF_ATTACHMENT" }]);
  });

  it("isolates a bad attachment — one failure doesn't take down the others", async () => {
    const email = rawEmail([
      { filename: "good.pdf", content: "good bytes" },
      { filename: "bad.pdf", content: "bad bytes" },
    ]);
    const extractText = vi.fn().mockImplementation(async (buffer: Buffer) => buffer.toString());
    const extractor = vi.fn().mockImplementation(async (text: string) => {
      if (text === "bad bytes") throw new Error("provider exploded");
      return validExtraction;
    });

    const results = await extractInvoicesFromEmail(email, { extractText, extractor });

    expect(results).toEqual([
      { status: "EXTRACTED", filename: "good.pdf", extraction: validExtraction },
      { status: "EXTRACTION_FAILED", filename: "bad.pdf", error: "provider exploded" },
    ]);
  });
});
