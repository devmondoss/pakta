import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { ApiPayable } from "../src/mapPayable.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

async function getPayable(payableId: string): Promise<ApiPayable> {
  const res = await app.inject({ method: "GET", url: "/payables" });
  const payables = res.json() as ApiPayable[];
  return payables.find((p) => p.payableId === payableId)!;
}

describe("HU-D2-15: wallet reverification flow", () => {
  it.each([
    ["the 24-character placeholder the demo used to ship", "GD2RT5W8XKLQPZ1N6MYH9VFJ"],
    ["a real address with one character changed (bad checksum)", "GBULRZJR3HMP4DRBMT5OFCO6RIX7QYUC5PVHBCZXXLTBLRTYKZQYIVIM"],
    ["a contract id instead of an account", "CDKC6UYM7JFZOIR3DSSHZWSNFB4NTYQ3X3AVJJ5MIU3UH6H4NBQON5GB"],
  ])("refuses %s — it would produce payables that can never settle", async (_label, address) => {
    const register = await app.inject({ method: "POST", url: "/vendors/VEN-004/wallet", payload: { address } });
    expect(register.statusCode).toBe(400);
    expect((await getPayable("PAY-INV-004")).exception?.reason).toBe("VENDOR_WALLET_CHANGED");
  });

  it("INV-004 starts BLOCKED with VENDOR_WALLET_CHANGED", async () => {
    const payable = await getPayable("PAY-INV-004");
    expect(payable.status).toBe("BLOCKED");
    expect(payable.exception?.reason).toBe("VENDOR_WALLET_CHANGED");
  });

  it("registering the invoice's wallet keeps it BLOCKED (now UNATTESTED_WALLET, not yet human-confirmed)", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/vendors/VEN-004/wallet",
      payload: { address: "GBULRZJR3HMP4DRBMT5OFCO6RIX7QYUC5PVHBCZXXLTBLRTYKZQYIVIN" },
    });
    expect(register.statusCode).toBe(200);
    expect(register.json()).toMatchObject({
      vendorId: "VEN-004",
      address: "GBULRZJR3HMP4DRBMT5OFCO6RIX7QYUC5PVHBCZXXLTBLRTYKZQYIVIN",
      attestationStatus: "UNATTESTED",
      version: 7,
    });

    const payable = await getPayable("PAY-INV-004");
    expect(payable.status).toBe("BLOCKED");
    expect(payable.exception?.reason).toBe("UNATTESTED_WALLET");
  });

  it("attesting the wallet clears the exception — the payable is READY on the very next read, no manual revalidate needed", async () => {
    const attest = await app.inject({ method: "POST", url: "/vendors/VEN-004/wallet/attest" });
    expect(attest.statusCode).toBe(200);
    expect(attest.json()).toMatchObject({ attestationStatus: "ATTESTED", version: 7 });

    const payable = await getPayable("PAY-INV-004");
    expect(payable.status).toBe("READY");
    expect(payable.exception).toBeUndefined();
  });

  it("POST /payables/:id/revalidate returns the same fresh result explicitly", async () => {
    const res = await app.inject({ method: "POST", url: "/payables/PAY-INV-004/revalidate" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ payableId: "PAY-INV-004", status: "READY" });
  });

  it("404s revalidate for an unknown payable", async () => {
    const res = await app.inject({ method: "POST", url: "/payables/PAY-NOPE/revalidate" });
    expect(res.statusCode).toBe(404);
  });

  it("400s wallet registration without an address", async () => {
    const res = await app.inject({ method: "POST", url: "/vendors/VEN-001/wallet", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("404s attest for a vendor with no wallet on file", async () => {
    const res = await app.inject({ method: "POST", url: "/vendors/VEN-DOES-NOT-EXIST/wallet/attest" });
    expect(res.statusCode).toBe(404);
  });
});
