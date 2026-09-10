// Presentation-only color thresholding on top of shared/sla.ts's already-
// computed clock state. Does NOT alter SLA math — elapsedMs/limitMs/breached
// come from currentClockState() unchanged; this only picks a Badge variant.
import type { TicketClockState } from "@hay-service-desk/shared";

export type SlaUrgency = "success" | "warning" | "error";

const CLOSE_TO_BREACH_RATIO = 0.75;

export function slaUrgency(clockState: Pick<TicketClockState, "elapsedMs" | "limitMs" | "breached">): SlaUrgency {
  if (clockState.breached) return "error";
  if (clockState.elapsedMs / clockState.limitMs >= CLOSE_TO_BREACH_RATIO) return "warning";
  return "success";
}
