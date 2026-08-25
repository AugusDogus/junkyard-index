import type { BillingAccountState } from "~/lib/billing-account";
import type { SubscriptionSelection } from "~/lib/subscription-selection";

export type SubscriptionIntent =
  | { kind: "manage" }
  | { kind: "upgrade"; selection: SubscriptionSelection };

export type SubscriptionAction =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "compare_plans" }
  | { kind: "checkout"; selection: SubscriptionSelection }
  | { kind: "portal" };

export function resolveSubscriptionAction(
  account: BillingAccountState,
  intent: SubscriptionIntent,
): SubscriptionAction {
  switch (account.kind) {
    case "loading":
      return { kind: "loading" };
    case "unavailable":
      return { kind: "unavailable" };
    case "active":
    case "needs_attention":
      return { kind: "portal" };
    case "none":
      return intent.kind === "upgrade"
        ? { kind: "checkout", selection: intent.selection }
        : { kind: "compare_plans" };
  }
}
