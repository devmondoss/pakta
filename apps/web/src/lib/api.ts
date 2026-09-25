// Server-side fetches against `apps/api` (Fastify). Types mirror the shapes
// that package actually returns — see `apps/api/src/mapPayable.ts` and
// `@pakta/canonical-model`'s `ProofOfPayable`.
import type {
  ExceptionReasonCode,
  ExceptionSeverity,
  OwnerRole,
  VendorVerificationStatus,
  WalletAttestationStatus,
} from "@pakta/canonical-model";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export type PayableStatus = "READY" | "BLOCKED" | "SETTLED";

export type Payable = {
  payableId: string;
  invoiceId: string;
  vendorName: string;
  vendorId: string;
  poId: string;
  amount: string;
  dueDate: string;
  status: PayableStatus;
  exception?: {
    reason: ExceptionReasonCode;
    message: string;
    severity: ExceptionSeverity;
    ownerRole: OwnerRole;
    requiredAction: string;
  };
  settlement?: {
    txHash: string;
    ledger: number;
    network: string;
    erpPostingStatus: string;
  };
};

export type Vendor = {
  vendorId: string;
  legalName: string;
  verificationStatus: VendorVerificationStatus;
  wallet?: {
    address: string;
    attestationStatus: WalletAttestationStatus;
    version: number;
  };
};

export type Summary = {
  totalRequested: string;
  totalReady: string;
  totalBlocked: string;
  totalSettled: string;
  payableCount: number;
  readyCount: number;
  blockedCount: number;
  settledCount: number;
};

export type ProofOfPayable = {
  payable_id: string;
  invoice_hash: string;
  po_hash: string;
  vendor_id: string;
  vendor_wallet: string;
  wallet_attestation_version: number;
  amount: string;
  asset: string;
  policy_version: string;
  approvals_hash: string;
  cost_center: string;
  expires_at: string;
  status: "READY";
};

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${path} responded ${res.status}`);
  return res.json();
}

export function getPayables(): Promise<Payable[]> {
  return apiFetch("/payables");
}

export function getVendors(): Promise<Vendor[]> {
  return apiFetch("/vendors");
}

export function getSummary(): Promise<Summary> {
  return apiFetch("/summary");
}

/** `null` if the payable doesn't exist or isn't READY yet (API returns 404/409 for those). */
export async function getProof(payableId: string): Promise<ProofOfPayable | null> {
  const res = await fetch(`${API_URL}/payables/${payableId}/proof`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}
