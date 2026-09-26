"use client";

export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="app-error">
      <p className="text-sm text-blocked">No se pudo conectar con la API.</p>
      <p className="text-xs text-muted">Confirmá que `apps/api` esté corriendo en {process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}.</p>
      <button
        onClick={() => retry()}
        className="app-button-primary mt-2"
      >
        Reintentar
      </button>
    </div>
  );
}
