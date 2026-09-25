"use client";

export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl bg-surface p-10 text-center">
      <p className="text-sm text-blocked">No se pudo conectar con la API.</p>
      <p className="text-xs text-muted">Confirmá que `apps/api` esté corriendo en {process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}.</p>
      <button
        onClick={() => retry()}
        className="mt-2 rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90"
      >
        Reintentar
      </button>
    </div>
  );
}
