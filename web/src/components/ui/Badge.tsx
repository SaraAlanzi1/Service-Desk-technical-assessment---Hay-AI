// Visual primitive only — a colored pill for status/urgency text that was
// previously plain text (or ad-hoc text-red-600 spans).
const variants = {
  neutral: "bg-brand-cream text-brand-primary border-brand-border",
  success: "bg-[#4A7C59]/10 text-brand-success border-brand-success/30",
  warning: "bg-[#C4842D]/10 text-brand-warning border-brand-warning/30",
  error: "bg-[#A83232]/10 text-brand-error border-brand-error/30",
  info: "bg-[#5B7FA5]/10 text-brand-info border-brand-info/30",
} as const;

export function Badge({
  variant = "neutral",
  children,
  className = "",
}: {
  variant?: keyof typeof variants;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-semibold ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
