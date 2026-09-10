import type { TicketPriority } from "@hay-service-desk/shared";
import { Badge } from "./Badge";

// Visual polish only — a colored pill for ticket priority, replacing plain
// lowercase text. Purely presentational; priority has no effect on SLA
// timing (unchanged).
const PRIORITY_VARIANT: Record<TicketPriority, "neutral" | "warning" | "error"> = {
  low: "neutral",
  medium: "warning",
  high: "error",
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return <Badge variant={PRIORITY_VARIANT[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}
