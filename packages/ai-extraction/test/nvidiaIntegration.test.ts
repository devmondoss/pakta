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

  const invoices = (
    demoInvoices.invoices as {
      file: string;
      layout: string;
      excludeFromGenericCheck?: boolean;
      expected?: { vendorName: string; invoiceId: string; amount: string; poReference?: string; walletAddress?: string };
      expectAbsent?: ("poReference" | "walletAddress")[];
    }[]
  ).filter((invoice) => !invoice.excludeFromGenericCheck);

  for (const invoice of invoices) {
    it(
      `extracts ${invoice.file} (${invoice.layout}) correctly`,
      async () => {
        const pdfBuffer = readFileSync(path.join(fixturesDir, invoice.file));
        const result = await extractInvoiceFromPdf(pdfBuffer, { extractor: extractor() });
        const expected = invoice.expected!;

        expect(result.vendorName.value.toLowerCase()).toContain(expected.vendorName.split(" ")[0]!.toLowerCase());
        expect(result.invoiceId.value).toBe(expected.invoiceId);
        expect(result.amount.value).toBe(expected.amount);
        if (expected.poReference) expect(result.poReference?.value).toBe(expected.poReference);
        if (expected.walletAddress) expect(result.walletAddress?.value).toBe(expected.walletAddress);

        // The schema's "omit this key entirely rather than guessing a
        // value" instruction — a field with nothing to extract must be
        // ABSENT, not hallucinated as an empty string or a guess.
        for (const field of invoice.expectAbsent ?? []) {
          expect(result[field]).toBeUndefined();
        }

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
      300_000,
    );
  }
});
