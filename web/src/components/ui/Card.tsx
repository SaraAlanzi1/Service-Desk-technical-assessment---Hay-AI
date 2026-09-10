// Visual primitive only — no behavior. Centralizes the "white card on cream
// background" surface treatment used across every page.
export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-brand-border bg-brand-surface p-6 shadow-sm ${className}`}>
      {children}
    </div>
  );
}
