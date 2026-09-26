export type Toast = { id: number; title: string; body: string };

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 0;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => listeners.delete(listener);
}

/** Aviso in-app — vive dentro de la UI, no depende de ningún permiso del navegador. */
export function pushToast(title: string, body: string): void {
  const id = nextId++;
  toasts = [...toasts, { id, title, body }];
  emit();
  setTimeout(() => dismissToast(id), 6000);
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
