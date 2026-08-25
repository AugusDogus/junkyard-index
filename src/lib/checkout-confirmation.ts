import type { PlanTier } from "~/lib/plans";

export type CheckoutConfirmationState =
  | { kind: "inactive" }
  | { kind: "polling"; deadlineMs: number }
  | { kind: "confirmed" }
  | { kind: "timed_out" };

export type CheckoutConfirmationEvent =
  | { kind: "started"; nowMs: number }
  | { kind: "stopped" }
  | { kind: "tier_resolved"; tier: PlanTier | null }
  | { kind: "deadline_reached" };

export const CHECKOUT_TIER_CONFIRMATION_TIMEOUT_MS = 30_000;
const CHECKOUT_TIER_CONFIRMATION_POLL_INTERVAL_MS = 2_000;
const PLAN_ACCESS_REVALIDATION_INTERVAL_MS = 60_000;

export function initialCheckoutConfirmationState(input: {
  enabled: boolean;
  nowMs: number;
}): CheckoutConfirmationState {
  return input.enabled
    ? {
        kind: "polling",
        deadlineMs: input.nowMs + CHECKOUT_TIER_CONFIRMATION_TIMEOUT_MS,
      }
    : { kind: "inactive" };
}

export function checkoutConfirmationReducer(
  state: CheckoutConfirmationState,
  event: CheckoutConfirmationEvent,
): CheckoutConfirmationState {
  switch (event.kind) {
    case "started":
      return state.kind === "inactive"
        ? initialCheckoutConfirmationState({ enabled: true, nowMs: event.nowMs })
        : state;
    case "stopped":
      return { kind: "inactive" };
    case "tier_resolved":
      return event.tier === "lite" || event.tier === "full"
        ? { kind: "confirmed" }
        : state;
    case "deadline_reached":
      return state.kind === "polling" ? { kind: "timed_out" } : state;
  }
}

export function checkoutConfirmationRefetchInterval(
  state: CheckoutConfirmationState,
): number {
  return state.kind === "polling"
    ? CHECKOUT_TIER_CONFIRMATION_POLL_INTERVAL_MS
    : PLAN_ACCESS_REVALIDATION_INTERVAL_MS;
}
