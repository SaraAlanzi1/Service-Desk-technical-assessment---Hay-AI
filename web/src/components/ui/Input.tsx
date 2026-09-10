// Visual primitives only — no behavior beyond what the raw <input>/
// <textarea>/<select> elements they replace already had.
const fieldClasses =
  "rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/40";

export function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldClasses} ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldClasses} ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${fieldClasses} ${className}`} {...props} />;
}
