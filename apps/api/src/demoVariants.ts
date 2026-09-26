import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { encodeAccountId } from "@pakta/stellar-sdk-wrapper";

const fixturesDir = path.resolve(import.meta.dirname, "../../../fixtures/demo-workbook");
const baseData = JSON.parse(readFileSync(path.join(fixturesDir, "demo-data.json"), "utf-8"));

export type DemoVariant = {
  label: string;
  vendorNames: [string, string, string, string, string];
  /** Pool this sector can draw extra (always-clean) vendors from — up to 5, for a 5-10 invoice range per run. */
  extraVendorPool: string[];
};

type ExtraInvoice = {
  vendorId: string;
  legalName: string;
  walletAddress: string;
  poId: string;
  invoiceId: string;
  amount: string;
};

/** What `pickVariant` hands back: the base variant plus the extra invoices it randomly drew for this run. */
export type ResolvedDemoVariant = DemoVariant & { extraInvoices: ExtraInvoice[]; interactive: boolean };

// Los casos interactivos se pagan de verdad en Stellar testnet. Reducirlos
// diez veces da espacio para repetir el flujo sin disfrazar la capacidad del
// vault ni tocar facturas que llegaron por ingesta real.
const INTERACTIVE_DEMO_AMOUNT_SCALE = 0.1;

function scaleDemoAmount(amount: string): string {
  return (Number(amount) * INTERACTIVE_DEMO_AMOUNT_SCALE).toFixed(2);
}

/**
 * 5 sets of fictional vendor names for "Probar con un caso real". La
 * fixture canónica conserva los importes documentados para pruebas; los
 * escenarios interactivos los escalan diez veces hacia abajo para permitir
 * más ciclos de settlement en testnet. Se preservan las relaciones de
 * invoice, PO, receipt, wallet y el duplicado conocido, por lo que el
 * resultado sigue siendo 1 READY + 4 BLOCKED y una excepción de cada tipo.
 */
export const DEMO_VARIANTS: DemoVariant[] = [
  {
    label: "Cloud & logística",
    vendorNames: ["CloudData Inc.", "Northline Supplies", "Meridian Logistics", "Arclight Components", "Harborview Services"],
    extraVendorPool: ["Latticework Hosting", "Pinecrest Freight", "Vantage Colo", "Ironhaul Transport", "Skyline Data Centers"],
  },
  {
    label: "Agroindustria",
    vendorNames: ["AgroPacífico Ltda.", "Semillas del Valle", "Exportadora Cafetal", "Fertilizantes Norte", "Cosecha Real"],
    extraVendorPool: ["Molinos del Sur", "Vivero Altamira", "Empaques Agroluz", "Riegos Cordillera", "Silos del Llano"],
  },
  {
    label: "Construcción",
    vendorNames: ["Cementos Altiplano", "Aceros del Puerto", "Maderera San Rafael", "Instalaciones Vertex", "Concreto Total"],
    extraVendorPool: ["Andamios Nortec", "Vidrios Marbella", "Eléctricos del Cauca", "Pinturas Cimarrón", "Grúas Peñalisa"],
  },
  {
    label: "Salud",
    vendorNames: ["Insumos Médicos Vitalia", "Farmacéutica Andesalud", "Laboratorios Bioquim", "Equipos Clínicos Norsan", "Distribuidora Sanare"],
    extraVendorPool: ["Suministros Cruz Azul", "Diagnóstica Prisma", "Ortopédicos Alameda", "Biotecnología Alterra", "Insumos Nortemed"],
  },
  {
    label: "Tecnología",
    vendorNames: ["Nimbus Data Systems", "Redshift Analytics", "Vector Cloud Co.", "Quanta Infra", "Latencia Cero SpA"],
    extraVendorPool: ["Cipher Security Labs", "Parallax Devtools", "Northbeam Analytics", "Monolith Storage", "Edge Relay Systems"],
  },
];

function randomAmount(): string {
  // Bajo el umbral de la segunda aprobación (5000.00) a propósito: estos
  // extras son siempre READY, y por encima de ese umbral exigirían una
  // segunda aprobación que no tienen — mejor no acercarse al borde.
  return (800 + Math.random() * 4000).toFixed(2);
}

function shuffledSample<T>(items: T[], count: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

/**
 * Genera una invoice extra siempre "limpia" — vendor nuevo, PO/wallet/
 * receipt/aprobación que calzan exacto, sin fingerprint repetido — así el
 * batch siempre puede tener entre 5 y 10 invoices sin arriesgar que una de
 * las 4 excepciones documentadas se rompa o se duplique por accidente.
 *
 * La wallet tiene que ser una StrKey `G...` válida de verdad — no alcanza
 * con que "parezca" una: `buildProofOfPayable` valida el checksum real, y
 * un string random con el prefijo pegado a mano lo rechazaba ahí (el
 * kernel no lo detecta porque no valida formato, solo atestación, así que
 * el payable llegaba a READY y recién se rompía al pedir el proof). No es
 * una cuenta fondeada en testnet — sirve para mostrar el proof, no para
 * liquidar de verdad esta wallet puntual.
 */
function buildExtraInvoice(legalName: string, seq: number): ExtraInvoice {
  return {
    vendorId: `VEN-1${String(seq).padStart(2, "0")}`,
    legalName,
    walletAddress: encodeAccountId(randomBytes(32)),
    poId: `PO-9${String(seq).padStart(4, "0")}`,
    invoiceId: `INV-1${String(seq).padStart(2, "0")}`,
    amount: randomAmount(),
  };
}

/**
 * `index` viene de la elección explícita del usuario en el picker; sin
 * él, se sortea. El número de invoices extra (0-5) y cuáles vendors del
 * pool les tocan se resuelven acá, una sola vez por corrida, para que el
 * workbook que se ingesta y el resumen que ve la UI muestren exactamente
 * lo mismo.
 *
 * `withExtras: false` desactiva esa variedad — la usa únicamente
 * `seedIfEmpty` al arrancar el server, donde el batch tiene que ser
 * reproducible (CI y los tests de `GET /payables` asumen el canónico
 * exacto de 5 invoices: 1 READY + 4 BLOCKED). Cualquier corrida disparada
 * desde el picker de la UI sí quiere la variedad, así que ahí se deja el
 * default.
 */
export function pickVariant(index?: number, opts: { withExtras?: boolean } = {}): ResolvedDemoVariant {
  const { withExtras = true } = opts;
  const variant = index !== undefined ? DEMO_VARIANTS[index] : DEMO_VARIANTS[Math.floor(Math.random() * DEMO_VARIANTS.length)];
  if (!variant) throw new Error(`no demo variant at index ${index}`);

  const extraCount = withExtras ? Math.floor(Math.random() * (variant.extraVendorPool.length + 1)) : 0;
  const extraInvoices = shuffledSample(variant.extraVendorPool, extraCount).map((name, i) => buildExtraInvoice(name, i + 1));

  return { ...variant, extraInvoices, interactive: withExtras };
}

function withVendorNames(variant: ResolvedDemoVariant) {
  const data = structuredClone(baseData);
  data.vendors.forEach((v: { legalName: string }, i: number) => {
    v.legalName = variant.vendorNames[i];
  });

  const today = new Date().toISOString().slice(0, 10);
  for (const extra of variant.extraInvoices) {
    data.vendors.push({
      vendorId: extra.vendorId,
      legalName: extra.legalName,
      verificationStatus: "VERIFIED",
      wallet: { address: extra.walletAddress, attestationStatus: "ATTESTED", version: 1, createdAt: today },
    });
    data.purchaseOrders.push({ poId: extra.poId, vendorId: extra.vendorId, amount: extra.amount, status: "OPEN", approverId: "controller@pakta.demo" });
    data.invoices.push({
      invoiceId: extra.invoiceId,
      poId: extra.poId,
      vendorId: extra.vendorId,
      amount: extra.amount,
      dueDate: "2026-09-23",
      walletAddress: extra.walletAddress,
      sourceHash: `sha256:demo-${extra.invoiceId.toLowerCase()}`,
    });
    data.receipts.push({ poId: extra.poId, confirmedQty: 1, invoicedQty: 1, confirmedBy: "ops@pakta.demo", confirmedAt: today });
    data.approvals.push({ objectType: "PO", objectId: extra.poId, policyVersion: "FIN-4.2", approverId: "controller@pakta.demo", timestamp: today });
  }

  // `interactive` identifica una corrida iniciada desde el picker de demo.
  // Solo esas corridas usan micro-settlements; el seed de arranque y los
  // tests siguen leyendo la fixture canónica sin alterarla.
  if (variant.interactive) {
    for (const po of data.purchaseOrders) po.amount = scaleDemoAmount(po.amount);
    for (const invoice of data.invoices) invoice.amount = scaleDemoAmount(invoice.amount);
  }

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
export async function buildDemoWorkbookBuffer(variant: ResolvedDemoVariant): Promise<Buffer> {
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
export function invoiceSummary(variant: ResolvedDemoVariant): { invoiceId: string; vendorName: string; amount: string }[] {
  const data = withVendorNames(variant);
  const vendorById = new Map(data.vendors.map((v: any) => [v.vendorId, v.legalName]));
  return data.invoices.map((inv: any) => ({
    invoiceId: inv.invoiceId,
    vendorName: vendorById.get(inv.vendorId) as string,
    amount: inv.amount,
  }));
}
