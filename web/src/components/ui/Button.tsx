// Visual primitive only — same click handlers/behavior as the raw <button>
// elements this replaces, just centralized styling.
export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  const base = "rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50";
  const variants = {
    primary: "bg-brand-primary text-brand-cream hover:bg-brand-primary/90",
    secondary: "border border-brand-border bg-brand-surface text-brand-primary hover:bg-brand-cream",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}
