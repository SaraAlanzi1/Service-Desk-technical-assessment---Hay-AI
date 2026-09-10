// Single source of truth for all SLA math in this project.
//
// Both web/ (countdown UI) and functions/ (breach detection, resolve
// calculations) MUST import from this file. Do not reimplement any of this
// logic elsewhere — see the locked design decisions on SLA logic:
//   - Acknowledge clock: 4h from submittedAt to acknowledgedAt, pauses have
//     no effect on this clock.
//   - Resolve clock: 48h from acknowledgedAt, with paused duration
//     subtracted (SLA-adjusted).
//   - Breach comparison is strictly exclusive: elapsed > limit, not >=.
//   - "Breach once, breach forever": firstBreachedAt persists once observed
//     and is never cleared, even if a later pause would arithmetically
//     un-breach the ticket.
//   - avgResolveTimeMinutes in MonthlyReport uses the SLA-adjusted
//     (pause-subtracted) resolve duration.
//
// Everything here takes/returns plain milliseconds, not FirestoreTimestamp
// or Date — callers (a ticking web countdown, a one-shot Cloud Function
// check) convert their own timestamp representation at the boundary. This
// keeps this file dependency-free and trivially testable.

import type { SlaClock, TicketWorkflowStatus } from "./types";

export const ACKNOWLEDGE_SLA_MS = 4 * 60 * 60 * 1000;
export const RESOLVE_SLA_MS = 48 * 60 * 60 * 1000;

// Strictly exclusive: elapsed > limit, not >=.
export function isBreached(elapsedMs: number, limitMs: number): boolean {
  return elapsedMs > limitMs;
}

export interface PauseInterval {
  pausedAtMs: number;
  // null = still open; its duration counts up to `nowMs`.
  resumedAtMs: number | null;
}

export function totalPauseDurationMs(pauses: PauseInterval[], nowMs: number): number {
  return pauses.reduce((sum, p) => sum + ((p.resumedAtMs ?? nowMs) - p.pausedAtMs), 0);
}

// 4h from submittedAt to acknowledgedAt. Pauses can only start once a
// ticket is acknowledged, so this clock never coexists with one.
export function acknowledgeElapsedMs(submittedAtMs: number, nowMs: number): number {
  return nowMs - submittedAtMs;
}

// 48h from acknowledgedAt, with total paused duration subtracted.
export function resolveElapsedMs(
  acknowledgedAtMs: number,
  pauses: PauseInterval[],
  nowMs: number,
): number {
  return nowMs - acknowledgedAtMs - totalPauseDurationMs(pauses, nowMs);
}

// SLA-adjusted resolve time for one already-resolved ticket, in minutes.
// resolvedAtMs stands in for "nowMs" — the clock stopped at resolution.
export function resolveTimeMinutes(
  acknowledgedAtMs: number,
  pauses: PauseInterval[],
  resolvedAtMs: number,
): number {
  return resolveElapsedMs(acknowledgedAtMs, pauses, resolvedAtMs) / 60_000;
}

// Used by both the admin stats dashboard (live) and generateMonthlyReport
// (persisted snapshot) so the two numbers can never diverge. Returns 0 for
// an empty set — there's nothing in the design doc dictating this default,
// but 0 is the conventional "average of nothing" for a stats display.
export function averageResolveTimeMinutes(
  entries: Array<{ acknowledgedAtMs: number; pauses: PauseInterval[]; resolvedAtMs: number }>,
): number {
  if (entries.length === 0) return 0;
  const total = entries.reduce(
    (sum, e) => sum + resolveTimeMinutes(e.acknowledgedAtMs, e.pauses, e.resolvedAtMs),
    0,
  );
  return total / entries.length;
}

export interface TicketClockState {
  clock: SlaClock;
  elapsedMs: number;
  limitMs: number;
  breached: boolean;
  // The wall-clock instant this clock crosses (or crossed) into breach.
  // Used both as firstBreachedAt's persisted timestamp (a real threshold
  // instant, not "whenever a transition function happened to run") and for
  // "breaches at HH:MM" display. While a ticket is actively paused, elapsed
  // is frozen (see resolveElapsedMs), so this value reads as "if resumed
  // right now, would breach at this instant" rather than a fixed deadline —
  // there is no fixed deadline while the clock isn't running.
  breachThresholdMs: number;
}

// The one function both web/ and functions/ call so live display and
// server-side breach detection can never diverge. Returns null once a
// ticket is resolved — there is no live clock on a terminal ticket.
//
// `firstBreachedAt`, when set, forces breached=true unconditionally — this
// is the *display* half of "breach once, breach forever". (The *persist*
// half — deciding whether to write firstBreachedAt in the first place — is
// each transition function's job, using this same function's live
// computation while firstBreachedAt is still null.) Missing this was a
// real gap: a ticket that breached and then got paused could arithmetically
// "un-breach" on the resolve clock, and nothing before this stopped the
// live display from reporting that as not-breached.
export function currentClockState(
  ticket: {
    workflowStatus: TicketWorkflowStatus;
    submittedAtMs: number;
    acknowledgedAtMs: number | null;
    firstBreachedAt: { timestampMs: number; clock: SlaClock } | null;
  },
  pauses: PauseInterval[],
  nowMs: number,
): TicketClockState | null {
  if (ticket.workflowStatus === "resolved") return null;

  if (ticket.firstBreachedAt) {
    const limitMs =
      ticket.firstBreachedAt.clock === "acknowledgement" ? ACKNOWLEDGE_SLA_MS : RESOLVE_SLA_MS;
    return {
      clock: ticket.firstBreachedAt.clock,
      elapsedMs: nowMs - ticket.firstBreachedAt.timestampMs + limitMs,
      limitMs,
      breached: true,
      breachThresholdMs: ticket.firstBreachedAt.timestampMs,
    };
  }

  if (ticket.acknowledgedAtMs == null) {
    const elapsedMs = acknowledgeElapsedMs(ticket.submittedAtMs, nowMs);
    return {
      clock: "acknowledgement",
      elapsedMs,
      limitMs: ACKNOWLEDGE_SLA_MS,
      breached: isBreached(elapsedMs, ACKNOWLEDGE_SLA_MS),
      breachThresholdMs: ticket.submittedAtMs + ACKNOWLEDGE_SLA_MS,
    };
  }

  const elapsedMs = resolveElapsedMs(ticket.acknowledgedAtMs, pauses, nowMs);
  return {
    clock: "resolve",
    elapsedMs,
    limitMs: RESOLVE_SLA_MS,
    breached: isBreached(elapsedMs, RESOLVE_SLA_MS),
    breachThresholdMs: nowMs + (RESOLVE_SLA_MS - elapsedMs),
  };
}
