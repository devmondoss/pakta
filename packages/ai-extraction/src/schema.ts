import { z } from "zod";

/**
 * Every extracted value carries its own confidence and the exact source
 * text it came from — required for HU-D2-11's auditability criterion, and
 * for `resolveExtraction`'s confidence gate (HU-D2-12) to work per-field
 * instead of on the extraction as a whole.
 */
function extractedField<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    value: valueSchema,
    confidence: z.number().min(0).max(1),
    sourceExcerpt: z.string().min(1),
  });
}

const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'must be a plain decimal string, e.g. "5000.00"');

/**
 * What Claude is allowed to return for one invoice document. Deliberately
 * has no fields that could act as instructions to the rest of the system
 * (no "approve", "override", "action") — see the system prompt in
 * `extractInvoice.ts` for why that matters.
 */
export const InvoiceExtraction = z.object({
  vendorName: extractedField(z.string().min(1)),
  invoiceId: extractedField(z.string().min(1)),
  amount: extractedField(decimalString),
  dueDate: extractedField(z.string().min(1)),
  poReference: extractedField(z.string().min(1)).optional(),
  walletAddress: extractedField(z.string().min(1)).optional(),
});
export type InvoiceExtraction = z.infer<typeof InvoiceExtraction>;
