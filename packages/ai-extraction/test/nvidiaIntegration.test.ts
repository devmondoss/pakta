import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractInvoiceFromPdf } from "../src/extractInvoice.js";
import { createNvidiaExtractor } from "../src/providers/nvidia.js";

/**
 * HU-D2-11's real acceptance test: ≥3 PDFs with genuinely different
 * layouts, run through the *actual* NVIDIA NIM provider (no mocked
 * extractor) and checked against known-correct field values. Skipped
 * whenever `NVIDIA_API_KEY` isn't set — `pnpm test` stays fast, offline,
 * and deterministic; this only runs when someone deliberately has a key
 * in their environment.
 */
const fixturesDir = path.resolve(import.meta.dirname, "../../../fixtures/demo-invoices");
const demoInvoices = JSON.parse(readFileSync(path.join(fixturesDir, "demo-invoices.json"), "utf-8"));

describe.skipIf(!process.env.NVIDIA_API_KEY)("real NVIDIA NIM extraction (HU-D2-11)", () => {
  // Created lazily inside each test, not here — `describe.skipIf`'s body
  // still runs during collection even when every `it` inside is skipped,
  // and `createNvidiaExtractor()` throws immediately without a key.
  const extractor = () => createNvidiaExtractor();

  for (const invoice of demoInvoices.invoices as {
    file: string;
    layout: string;
    expected: { vendorName: string; invoiceId: string; amount: string; poReference: string; walletAddress: string };
  }[]) {
    it(
      `extracts ${invoice.file} (${invoice.layout}) correctly`,
      async () => {
        const pdfBuffer = readFileSync(path.join(fixturesDir, invoice.file));
        const result = await extractInvoiceFromPdf(pdfBuffer, { extractor: extractor() });

        expect(result.vendorName.value.toLowerCase()).toContain(invoice.expected.vendorName.split(" ")[0]!.toLowerCase());
        expect(result.invoiceId.value).toBe(invoice.expected.invoiceId);
        expect(result.amount.value).toBe(invoice.expected.amount);
        expect(result.poReference?.value).toBe(invoice.expected.poReference);
        expect(result.walletAddress?.value).toBe(invoice.expected.walletAddress);

        // HU-D2-11's auditability criterion: every field carries its own
        // confidence and the exact source text it came from.
        for (const field of [result.vendorName, result.invoiceId, result.amount, result.dueDate]) {
          expect(field.confidence).toBeGreaterThan(0);
          expect(field.sourceExcerpt.length).toBeGreaterThan(0);
        }
      },
      // This model reasons at length before answering — a single call
      // against the full extraction prompt can take 1-3 minutes, with
      // real variance run to run (it's genuinely thinking, not stuck).
      240_000,
    );
  }
});
