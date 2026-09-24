import type { Exception, OwnerRole } from "@pakta/canonical-model";
import type { ExceptionNotifier } from "./notifier.js";
import { toNotificationPayload } from "./notifier.js";

/** One webhook URL per owner role — "enrutado a la bandeja del owner", not one shared inbox for everyone. */
export type OwnerWebhooks = Partial<Record<OwnerRole, string>>;

export function createWebhookNotifier(
  routes: OwnerWebhooks,
  opts?: { defaultUrl?: string; fetchImpl?: typeof fetch },
): ExceptionNotifier {
  const doFetch = opts?.fetchImpl ?? fetch;

  return async function notifyViaWebhook(exception: Exception): Promise<void> {
    const url = routes[exception.ownerRole] ?? opts?.defaultUrl;
    if (!url) {
      throw new Error(`no webhook route for owner "${exception.ownerRole}" and no default url configured`);
    }

    const response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toNotificationPayload(exception)),
    });

    if (!response.ok) {
      throw new Error(`webhook to ${url} responded with ${response.status}`);
    }
  };
}
