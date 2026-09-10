// Visual polish only — replaces a blank flash while a page's own data query
// is still in flight. Not used in the auth route guards (layout.tsx files)
// or the login page, which intentionally render nothing during their brief
// auth-check window.
export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <p className="text-sm text-brand-primary/50">{label}</p>
    </main>
  );
}
