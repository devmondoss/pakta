"use client";

import { useEffect, useState } from "react";
import { notificationPermission, requestNotificationPermission } from "@/lib/notify";

/**
 * Un solo botón para prender los avisos del navegador — "un vendor salió de
 * Resolución", "settlement confirmado en Stellar", "reconciliación
 * confirmada" — para que la demo se sienta viva aunque no estés mirando la
 * pestaña. Se esconde solo una vez que el navegador ya tiene una decisión
 * tomada (granted o denied); mientras esté en "default" hay que pedirlo.
 */
export function NotificationsToggle() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");

  useEffect(() => setPermission(notificationPermission()), []);

  if (permission !== "default") return null;

  return (
    <button
      type="button"
      onClick={async () => setPermission(await requestNotificationPermission())}
      className="app-button-secondary"
    >
      Activar notificaciones
    </button>
  );
}
