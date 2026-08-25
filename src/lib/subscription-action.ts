import type { BillingAccountState } from "~/lib/billing-account";
import type { SubscriptionSelection } from "~/lib/subscription-selection";

export type SubscriptionIntent =
  | { kind: "manage" }
  | { kind: "upgrade"; selection: SubscriptionSelection };

type SubscriptionPortalAccount =
  | { kind: "active"; tier: SubscriptionSelection["tier"] }
  | { kind: "needs_attention" };

export type SubscriptionUpgradeAction =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "checkout"; selection: SubscriptionSelection }
  | {
      kind: "portal";
      account: SubscriptionPortalAccount;
      selection: SubscriptionSelection;
    };

export type SubscriptionManageAction =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "compare_plans" }
  | { kind: "portal"; account: SubscriptionPortalAccount };

export type SubscriptionAction =
  | SubscriptionUpgradeAction
  | SubscriptionManageAction;

export function resolveSubscriptionAction(
  account: BillingAccountState,
  intent: Extract<SubscriptionIntent, { kind: "upgrade" }>,
): SubscriptionUpgradeAction;
export function resolveSubscriptionAction(
  account: BillingAccountState,
  intent: Extract<SubscriptionIntent, { kind: "manage" }>,
): SubscriptionManageAction;
export function resolveSubscriptionAction(
  account: BillingAccountState,
  intent: SubscriptionIntent,
): SubscriptionAction;
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
      return intent.kind === "upgrade"
        ? {
            kind: "portal",
            account: { kind: "active", tier: account.tier },
            selection: intent.selection,
          }
        : {
            kind: "portal",
            account: { kind: "active", tier: account.tier },
          };
    case "needs_attention":
      return intent.kind === "upgrade"
        ? {
            kind: "portal",
            account: { kind: "needs_attention" },
            selection: intent.selection,
          }
        : { kind: "portal", account: { kind: "needs_attention" } };
    case "none":
      return intent.kind === "upgrade"
        ? { kind: "checkout", selection: intent.selection }
        : { kind: "compare_plans" };
  }
}
