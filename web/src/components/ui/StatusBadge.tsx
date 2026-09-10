import type { TicketWorkflowStatus } from "@hay-service-desk/shared";
import { Badge } from "./Badge";

// Visual polish only — a consistent colored pill for workflowStatus,
// replacing plain lowercase text. No status logic here: the value is read
// straight from the already-computed Ticket field.
const STATUS_VARIANT: Record<TicketWorkflowStatus, "neutral" | "info" | "success"> = {
  submitted: "neutral",
  acknowledged: "info",
  paused: "info",
  resolved: "success",
};

const STATUS_LABEL: Record<TicketWorkflowStatus, string> = {
  submitted: "Submitted",
  acknowledged: "Acknowledged",
  paused: "Paused",
  resolved: "Resolved",
};

export function StatusBadge({ status }: { status: TicketWorkflowStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
