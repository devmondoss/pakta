const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Client-side POST for dashboard actions. Surfaces failures with an alert
 * instead of swallowing them — a silent failure reads as "the button does
 * nothing", which is worse than a clear message. Returns whether it worked.
 */
export async function postAction(path: string, body?: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    if (res.ok) return true;
    const payload = await res.json().catch(() => ({}));
    window.alert(payload.error ?? `La API respondió ${res.status}`);
  } catch {
    window.alert("No se pudo conectar con la API. ¿Está corriendo en el puerto 4000?");
  }
  return false;
}
