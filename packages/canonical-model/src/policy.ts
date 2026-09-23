import { z } from "zod";

/**
 * Mirrors the YAML example in `Pakta_Documento_Maestro.md` §18.4 exactly.
 * Lives in canonical-model (not rules-kernel) because both the Ingestion
 * Service (`require_po`) and the rules kernel (everything else) need to
 * read it — a single shared shape avoids the two packages drifting apart
 * on what "policy" means.
 */
const decimalString = z.string().regex(/^\d+(\.\d{1,2})?$/);

export const Policy = z.object({
  policyVersion: z.string().min(1),
  rules: z.object({
    require_po: z.boolean(),
    require_receipt: z.boolean(),
    amount_tolerance_pct: z.number().min(0).max(100),
    duplicate_detection: z.boolean(),
    wallet_change_requires_human: z.boolean(),
    auto_pay_below: decimalString,
    second_approval_above: decimalString,
  }),
});
export type Policy = z.infer<typeof Policy>;
