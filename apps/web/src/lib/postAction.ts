import { pushToast } from "@/lib/toast";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Client-side POST for dashboard actions. Los errores se muestran como un
 * toast no bloqueante: el usuario ve qué pasó sin perder el contexto del
 * flujo ni tener que descartar un diálogo nativo del navegador.
 *
 * La API real responde casi al instante — sin la pausa artificial, el botón
 * pasa de "Confirmando…" a resuelto en el mismo frame, y se lee como si no
 * hubiera pasado nada. La demora simula un backend que de verdad está
 * verificando algo, dándole tiempo al usuario a leer el estado "pending".
 */
export async function postAction(path: string, body?: unknown, method: "POST" | "PATCH" = "POST"): Promise<boolean> {
  try {
    const [res] = await Promise.all([
      fetch(`${API_URL}${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      }),
      wait(1400),
    ]);
    if (res.ok) return true;
    const payload = await res.json().catch(() => ({}));
    const detail = typeof payload.error === "string" ? payload.error : "";
    // `TRY_AGAIN_LATER` es una respuesta transitoria del nodo; no es una
    // instrucción accionable para la persona usando Pakta. Los rechazos de
    // cadena que no se arreglan reintentando merecen una explicación precisa.
    if (detail.includes("registered on-chain with a different")) {
      pushToast(
        "El proof registrado no coincide",
        "Este lote ya fue registrado con evidencia distinta. Hay que revocarlo y emitir un payable nuevo; reintentar no puede mover fondos.",
        "error",
      );
    } else if (detail.includes("settle was refused by the gate: UnknownIssuer")) {
      pushToast(
        "La wallet del proveedor no está lista en testnet",
        "Este lote antiguo apunta a una cuenta que no puede recibir el activo de prueba. Hay que revocarlo y reemitirlo con una wallet atestada.",
        "error",
      );
    } else if (detail.includes("TRY_AGAIN_LATER")) {
      pushToast("La red está ocupada", "Esperá unos segundos e intentá nuevamente.", "error");
    } else {
      pushToast("No se pudo completar la acción", "Intentá nuevamente.", "error");
    }
  } catch {
    pushToast("No se pudo conectar", "La API no está disponible en este momento. Intentá nuevamente en unos segundos.", "error");
  }
  return false;
}
