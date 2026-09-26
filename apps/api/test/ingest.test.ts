import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetDb } from "@pakta/db";
import { buildApp } from "../src/app.js";
import { getDb } from "../src/db.js";

let app: FastifyInstance;

beforeAll(async () => {
  await resetDb(await getDb());
  app = await buildApp();
});

const workbookPath = path.resolve(import.meta.dirname, "../../../fixtures/demo-workbook/demo-workbook.xlsx");

/** Fastify's `.inject()` doesn't build multipart bodies for you — assemble one by hand. */
function multipartBody(fieldName: string, filename: string, contents: Buffer) {
  const boundary = "----paktaTestBoundary";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, contents, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe("POST /ingest — the real intake path (no fixture re-derivation)", () => {
  it("ingests a real workbook upload and persists it, no residual mock data involved", async () => {
    const workbookBuffer = readFileSync(workbookPath);
    const { payload, headers } = multipartBody("file", "demo-workbook.xlsx", workbookBuffer);

    const res = await app.inject({ method: "POST", url: "/ingest", payload, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: "workbook", ingested: 5, rejectedRows: [] });

    const payables = await app.inject({ method: "GET", url: "/payables" });
    expect(payables.json()).toHaveLength(5);
  });

  it("re-uploading the same workbook overwrites payables by id instead of duplicating them", async () => {
    const workbookBuffer = readFileSync(workbookPath);
    const { payload, headers } = multipartBody("file", "demo-workbook.xlsx", workbookBuffer);

    await app.inject({ method: "POST", url: "/ingest", payload, headers });
    const { payload: payload2, headers: headers2 } = multipartBody("file", "demo-workbook.xlsx", workbookBuffer);
    await app.inject({ method: "POST", url: "/ingest", payload: payload2, headers: headers2 });

    const payables = await app.inject({ method: "GET", url: "/payables" });
    expect(payables.json()).toHaveLength(5);
  });

  it("400s when no file is attached", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/ingest",
      payload: "--x--\r\n",
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s for a file that isn't a valid workbook", async () => {
    const { payload, headers } = multipartBody("file", "not-a-workbook.txt", Buffer.from("hello, this is not an xlsx"));
    const res = await app.inject({ method: "POST", url: "/ingest", payload, headers });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /ingest — PDF invoices go through AI extraction, not the workbook parser", () => {
  const pdfPath = path.resolve(import.meta.dirname, "../../../fixtures/demo-invoices/invoice-1-simple-list.pdf");
  const field = (value: string) => ({ value, confidence: 0.95, sourceExcerpt: value });

  async function uploadPdf(extraction: unknown) {
    const pdfApp = await buildApp({ extractor: async () => extraction });
    const { payload, headers } = multipartBody("file", "invoice.pdf", readFileSync(pdfPath));
    return pdfApp.inject({ method: "POST", url: "/ingest", payload, headers });
  }

  it("persists a PDF whose vendor and PO match the system's records", async () => {
    const res = await uploadPdf({
      vendorName: field("CloudData Inc."),
      invoiceId: field("INV-PDF-001"),
      amount: field("5000.00"),
      dueDate: field("2026-10-15"),
      poReference: field("PO-72881"),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: "pdf", status: "CANDIDATE", payableId: "PAY-INV-PDF-001" });

    const payables = await app.inject({ method: "GET", url: "/payables" });
    expect(payables.json().map((p: { payableId: string }) => p.payableId)).toContain("PAY-INV-PDF-001");
  });

  it("returns NEEDS_REVIEW with the extraction when the PO isn't on file, and persists nothing", async () => {
    const before = (await app.inject({ method: "GET", url: "/payables" })).json().length;
    const res = await uploadPdf({
      vendorName: field("CloudData Inc."),
      invoiceId: field("INV-PDF-002"),
      amount: field("12450.00"),
      dueDate: field("2026-10-15"),
      poReference: field("PO-88213"),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: "pdf", status: "NEEDS_REVIEW", extraction: { invoiceId: { value: "INV-PDF-002" } } });
    expect(res.json().reason).toMatch(/^PO_NOT_FOUND/);
    expect((await app.inject({ method: "GET", url: "/payables" })).json()).toHaveLength(before);
  });

  it("422s when the AI output doesn't match the extraction schema", async () => {
    const res = await uploadPdf({ vendorName: "not a field object" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/could not extract invoice from PDF/);
  });
});
