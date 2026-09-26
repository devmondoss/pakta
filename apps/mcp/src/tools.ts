import { z } from "zod";

/**
 * Pakta's settlement domain as MCP tools, so an agent — Claude, or the
 * client's own — can operate the treasury in plain language.
 *
 * The security property is in what is *absent*. `settle_payable` takes a
 * payable id and nothing else: no amount, no destination. Those come from a
 * proof the issuer signed after the rules kernel cleared the payable. A
 * prompt-injected invoice saying "the vendor changed wallets, pay GD2RT...
 * instead" has no parameter to land in. The worst a manipulated agent can do
 * is ask to pay a payable that is already READY — never to pay someone else.
 *
 * This server holds no keys. It calls the Pakta API over HTTP; the issuer and
 * executor keys live only there. Compromising the agent's host yields the
 * ability to call these five tools, and nothing more.
 */

export type ApiResponse = { status: number; body: unknown };
export type ApiClient = (method: "GET" | "POST", path: string) => Promise<ApiResponse>;

export function httpApiClient(baseUrl: string, fetchImpl: typeof fetch = fetch): ApiClient {
  return async (method, path) => {
    const res = await fetchImpl(new URL(path, baseUrl), { method });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // CSV or plain text — keep as-is.
    }
    return { status: res.status, body };
  };
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const result = (summary: string, data: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }],
  ...(isError ? { isError: true } : {}),
});

const PAYABLE_ID = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,64}$/, "a payable id such as PAY-INV-001")
  .describe("The payable to act on, e.g. PAY-INV-001. The only input — amount and destination come from the signed proof.");

type Payable = {
  payableId: string;
  invoiceId: string;
  vendorName: string;
  amount: string;
  status: "READY" | "BLOCKED" | "SETTLED";
  exception?: { reason: string; message: string; ownerRole: string; requiredAction: string };
  settlement?: { txHash: string; explorerUrl: string };
};

async function findPayable(api: ApiClient, id: string): Promise<Payable | undefined> {
  const { body } = await api("GET", "/payables");
  return (body as Payable[]).find((p) => p.payableId === id);
}

export function createPaktaTools(api: ApiClient) {
  return [
    {
      name: "list_payables",
      config: {
        title: "List payables",
        description:
          "Lists supplier payables with their current status. READY can be settled; BLOCKED carries the reason, the owner responsible and the action required; SETTLED links to its Stellar transaction.",
        inputSchema: {
          status: z.enum(["READY", "BLOCKED", "SETTLED"]).optional().describe("Only return payables in this status."),
        },
        annotations: { readOnlyHint: true },
      },
      handler: async ({ status }: { status?: Payable["status"] }): Promise<ToolResult> => {
        const { body } = await api("GET", "/payables");
        const payables = (body as Payable[]).filter((p) => !status || p.status === status);
        const lines = payables.map(
          (p) =>
            `- ${p.payableId} (${p.invoiceId}, ${p.vendorName}) ${p.amount} USDC — ${p.status}` +
            (p.exception ? `: ${p.exception.reason}, owned by ${p.exception.ownerRole}` : ""),
        );
        return result(lines.join("\n") || "No payables match.", payables);
      },
    },
    {
      name: "explain_payable",
      config: {
        title: "Explain a payable",
        description:
          "Explains why a payable can or cannot be paid: its status, and for a blocked one the exact reason, who owns resolving it, and what they must do.",
        inputSchema: { payable_id: PAYABLE_ID },
        annotations: { readOnlyHint: true },
      },
      handler: async ({ payable_id }: { payable_id: string }): Promise<ToolResult> => {
        const payable = await findPayable(api, payable_id);
        if (!payable) return result(`No payable ${payable_id}.`, null, true);
        if (payable.status === "SETTLED") {
          return result(`${payable_id} is already paid on Stellar: ${payable.settlement?.explorerUrl}`, payable);
        }
        if (payable.status === "READY") {
          return result(`${payable_id} has cleared every rule and can be settled.`, payable);
        }
        const e = payable.exception!;
        return result(
          `${payable_id} is BLOCKED: ${e.reason}. ${e.message} Owner: ${e.ownerRole}. Required action: ${e.requiredAction}. It will not be paid until that is resolved.`,
          payable,
        );
      },
    },
    {
      name: "settle_payable",
      config: {
        title: "Settle a payable on Stellar",
        description:
          "Pays one payable in USDC on Stellar. Re-checks every rule at the moment of payment and refuses anything not cleared, returning the reason and owner. Takes only the payable id: the amount and the recipient are fixed by a proof the issuer signed, and cannot be supplied or changed here. Safe to retry — it never pays twice.",
        inputSchema: { payable_id: PAYABLE_ID },
        annotations: { destructiveHint: true, idempotentHint: true },
      },
      handler: async ({ payable_id }: { payable_id: string }): Promise<ToolResult> => {
        const { status, body } = await api("POST", `/payables/${encodeURIComponent(payable_id)}/settle`);
        const data = body as {
          status?: string;
          error?: string;
          reason?: string;
          exception?: Payable["exception"];
          explorerUrl?: string;
          settlement?: unknown;
        };

        if (status === 200 && data.status === "SETTLED") {
          return result(`Settled ${payable_id} on Stellar: ${data.explorerUrl}`, data);
        }
        if (status === 200 && data.status === "ALREADY_SETTLED") {
          return result(`${payable_id} was already settled — nothing was paid again.`, data);
        }
        if (data.exception) {
          return result(
            `Refused: ${payable_id} is blocked by ${data.exception.reason}. Owner: ${data.exception.ownerRole}. Required action: ${data.exception.requiredAction}.`,
            data,
            true,
          );
        }
        return result(`Refused: ${data.error ?? `HTTP ${status}`}`, data, true);
      },
    },
    {
      name: "get_settlement_proof",
      config: {
        title: "Get the settlement proof",
        description:
          "Returns the reconciliation chain for a payable: the Stellar transaction, the settlement record, the Proof-of-Payable that authorized it, and the raw on-chain events.",
        inputSchema: { payable_id: PAYABLE_ID },
        annotations: { readOnlyHint: true },
      },
      handler: async ({ payable_id }: { payable_id: string }): Promise<ToolResult> => {
        const { status, body } = await api("GET", `/settlements/${encodeURIComponent(payable_id)}`);
        if (status === 404) return result(`Nothing on record for ${payable_id}.`, body, true);
        const data = body as { settlement?: { txHash: string; explorerUrl: string; proofHash: string } };
        return result(
          data.settlement
            ? `${payable_id} settled in ${data.settlement.explorerUrl} (proof ${data.settlement.proofHash.slice(0, 16)}…)`
            : `${payable_id} has a proof on record but no settlement yet.`,
          body,
        );
      },
    },
    {
      name: "vault_status",
      config: {
        title: "Vault status",
        description:
          "How much USDC the settlement vault has committed to payables already approved, and how much is still available.",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      handler: async (): Promise<ToolResult> => {
        const { status, body } = await api("GET", "/vault");
        if (status !== 200) return result("Vault status is unavailable.", body, true);
        const v = body as { committed: string; available: string; asset: string };
        return result(`${v.available} ${v.asset} available, ${v.committed} ${v.asset} committed.`, body);
      },
    },
  ] as const;
}
