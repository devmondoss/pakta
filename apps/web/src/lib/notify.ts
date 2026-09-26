export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return Promise.resolve("denied");
  return Notification.requestPermission();
}

/** No-op unless the viewer already granted permission — never re-prompts on its own. */
export function notify(title: string, body: string): void {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch {
    // Some browsers (iOS Safari) throw on `new Notification` even when permission is "granted".
  }
}
