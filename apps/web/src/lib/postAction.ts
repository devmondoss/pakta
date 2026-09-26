const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Client-side POST for dashboard actions. Surfaces failures with an alert
 * instead of swallowing them — a silent failure reads as "the button does
 * nothing", which is worse than a clear message. Returns whether it worked.
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
    window.alert(payload.error ?? `La API respondió ${res.status}`);
  } catch {
    window.alert("No se pudo conectar con la API. ¿Está corriendo en el puerto 4000?");
  }
  return false;
}
