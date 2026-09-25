export default function Loading() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-32 animate-pulse rounded-3xl bg-surface" />
      <div className="h-16 animate-pulse rounded-2xl bg-surface" />
      <div className="h-16 animate-pulse rounded-2xl bg-surface" />
      <div className="h-16 animate-pulse rounded-2xl bg-surface" />
    </div>
  );
}
