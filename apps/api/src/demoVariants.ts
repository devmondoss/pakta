import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

const fixturesDir = path.resolve(import.meta.dirname, "../../../fixtures/demo-workbook");
const baseData = JSON.parse(readFileSync(path.join(fixturesDir, "demo-data.json"), "utf-8"));

export type DemoVariant = { label: string; vendorNames: [string, string, string, string, string] };

/**
 * 10 sets of fictional vendor names for "Usar datos de ejemplo" — every
 * other field (amounts, PO/receipt/wallet relationships, the known
 * duplicate fingerprint) stays exactly what `demo-data.json` already has.
 * That's deliberate: those numbers are what makes INV-001..005 land on
 * the exact canonical outcome (§17.3/§25 del maestro) — 1 READY + 4
 * BLOCKED with the right reason codes. Varying only the company names
 * gives real visual variety on every load without any risk of silently
 * breaking DUPLICATE_INVOICE / PO_AMOUNT_MISMATCH / VENDOR_WALLET_CHANGED
 * / MISSING_RECEIPT.
 */
export const DEMO_VARIANTS: DemoVariant[] = [
  {
    label: "Cloud & logística",
    vendorNames: ["CloudData Inc.", "Northline Supplies", "Meridian Logistics", "Arclight Components", "Harborview Services"],
  },
  {
    label: "Manufactura textil",
    vendorNames: ["Telar del Sur S.A.", "Hilanderías Vintex", "Confecciones Roble", "Distribuidora Andina", "Textiles Cumbre"],
  },
  {
    label: "Agroindustria",
    vendorNames: ["AgroPacífico Ltda.", "Semillas del Valle", "Exportadora Cafetal", "Fertilizantes Norte", "Cosecha Real"],
  },
  {
    label: "Construcción",
    vendorNames: ["Cementos Altiplano", "Aceros del Puerto", "Maderera San Rafael", "Instalaciones Vertex", "Concreto Total"],
  },
  {
    label: "Retail y consumo",
    vendorNames: ["Almacenes Rioclaro", "Distribuciones Kori", "Bodegas del Istmo", "Comercial Zafiro", "Mayorista Andes"],
  },
  {
    label: "Salud",
    vendorNames: ["Insumos Médicos Vitalia", "Farmacéutica Andesalud", "Laboratorios Bioquim", "Equipos Clínicos Norsan", "Distribuidora Sanare"],
  },
  {
    label: "Energía",
    vendorNames: ["Energía Solar del Pacífico", "Turbinas Meridiano", "Redes Eléctricas Boreal", "Combustibles Delta", "Grid Servicios"],
  },
  {
    label: "Transporte",
    vendorNames: ["Fletes Cordillera", "Naviera Austral", "Transportes Rauco", "Aerocarga Kuntur", "Logística Puelche"],
  },
  {
    label: "Tecnología",
    vendorNames: ["Nimbus Data Systems", "Redshift Analytics", "Vector Cloud Co.", "Quanta Infra", "Latencia Cero SpA"],
  },
  {
    label: "Servicios profesionales",
    vendorNames: ["Consultora Prisma", "Estudio Legal Marín", "Auditores del Río", "Ingeniería Cardinal", "Contable Meridiano"],
  },
];

/** `index` viene de la elección explícita del usuario en el picker; sin él, se sortea. */
export function pickVariant(index?: number): DemoVariant {
  if (index !== undefined) {
    const variant = DEMO_VARIANTS[index];
    if (!variant) throw new Error(`no demo variant at index ${index}`);
    return variant;
  }
  return DEMO_VARIANTS[Math.floor(Math.random() * DEMO_VARIANTS.length)];
}

function withVendorNames(variant: DemoVariant) {
  const data = structuredClone(baseData);
  data.vendors.forEach((v: { legalName: string }, i: number) => {
    v.legalName = variant.vendorNames[i];
  });
  return data;
}

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: { header: string; key: string }[],
  rows: Record<string, unknown>[],
) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  for (const row of rows) sheet.addRow(row);
}

/**
 * Ports `fixtures/demo-workbook/build-fixture.ts`'s sheet layout to build
 * an in-memory workbook for a given variant, instead of always reading
 * the one checked-in `.xlsx`. Same columns, same schema `@pakta/ingestion`
 * already parses — only the source data object changes.
 */
export async function buildDemoWorkbookBuffer(variant: DemoVariant): Promise<Buffer> {
  const data = withVendorNames(variant);
  const workbook = new ExcelJS.Workbook();

  addSheet(
    workbook,
    "VENDORS",
    [
      { header: "vendor_id", key: "vendor_id" },
      { header: "legal_name", key: "legal_name" },
      { header: "verification_status", key: "verification_status" },
      { header: "wallet_address", key: "wallet_address" },
      { header: "wallet_attestation_status", key: "wallet_attestation_status" },
      { header: "wallet_version", key: "wallet_version" },
      { header: "wallet_created_at", key: "wallet_created_at" },
    ],
    data.vendors.map((v: any) => ({
      vendor_id: v.vendorId,
      legal_name: v.legalName,
      verification_status: v.verificationStatus,
      wallet_address: v.wallet.address,
      wallet_attestation_status: v.wallet.attestationStatus,
      wallet_version: v.wallet.version,
      wallet_created_at: v.wallet.createdAt,
    })),
  );

  addSheet(
    workbook,
    "PO",
    [
      { header: "po_id", key: "po_id" },
      { header: "vendor_id", key: "vendor_id" },
      { header: "amount", key: "amount" },
      { header: "status", key: "status" },
      { header: "approver_id", key: "approver_id" },
    ],
    data.purchaseOrders.map((po: any) => ({
      po_id: po.poId,
      vendor_id: po.vendorId,
      amount: po.amount,
      status: po.status,
      approver_id: po.approverId,
    })),
  );

  addSheet(
    workbook,
    "INVOICES",
    [
      { header: "invoice_id", key: "invoice_id" },
      { header: "po_id", key: "po_id" },
      { header: "vendor_id", key: "vendor_id" },
      { header: "amount", key: "amount" },
      { header: "due_date", key: "due_date" },
      { header: "wallet_address", key: "wallet_address" },
      { header: "source_hash", key: "source_hash" },
    ],
    data.invoices.map((inv: any) => ({
      invoice_id: inv.invoiceId,
      po_id: inv.poId,
      vendor_id: inv.vendorId,
      amount: inv.amount,
      due_date: inv.dueDate,
      wallet_address: inv.walletAddress,
      source_hash: inv.sourceHash,
    })),
  );

  addSheet(
    workbook,
    "RECEIPTS",
    [
      { header: "po_id", key: "po_id" },
      { header: "confirmed_qty", key: "confirmed_qty" },
      { header: "invoiced_qty", key: "invoiced_qty" },
      { header: "confirmed_by", key: "confirmed_by" },
      { header: "confirmed_at", key: "confirmed_at" },
    ],
    data.receipts.map((r: any) => ({
      po_id: r.poId,
      confirmed_qty: r.confirmedQty,
      invoiced_qty: r.invoicedQty,
      confirmed_by: r.confirmedBy,
      confirmed_at: r.confirmedAt,
    })),
  );

  addSheet(
    workbook,
    "APPROVALS",
    [
      { header: "object_type", key: "object_type" },
      { header: "object_id", key: "object_id" },
      { header: "policy_version", key: "policy_version" },
      { header: "approver_id", key: "approver_id" },
      { header: "timestamp", key: "timestamp" },
    ],
    data.approvals.map((a: any) => ({
      object_type: a.objectType,
      object_id: a.objectId,
      policy_version: a.policyVersion,
      approver_id: a.approverId,
      timestamp: a.timestamp,
    })),
  );

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** For the run-history log — invoiceId/vendorName/amount as this variant loaded them. */
export function invoiceSummary(variant: DemoVariant): { invoiceId: string; vendorName: string; amount: string }[] {
  const data = withVendorNames(variant);
  const vendorById = new Map(data.vendors.map((v: any) => [v.vendorId, v.legalName]));
  return data.invoices.map((inv: any) => ({
    invoiceId: inv.invoiceId,
    vendorName: vendorById.get(inv.vendorId) as string,
    amount: inv.amount,
  }));
}
