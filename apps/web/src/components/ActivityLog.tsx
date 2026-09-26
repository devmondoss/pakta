import type { ActivityEntry } from "@/lib/api";

/** Actividad real reciente del sistema — subidas, resoluciones, settlements. Nunca un dato de demo disfrazado de historial. */
export function ActivityLog({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <div className="activity-log">
      <p className="activity-log-heading">Actividad reciente</p>
      {entries.map((entry) => (
        <div key={entry.id} className="activity-row">
          <time className="activity-time">
            {new Date(entry.occurredAt).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </time>
          <span>{entry.message}</span>
        </div>
      ))}
    </div>
  );
}
