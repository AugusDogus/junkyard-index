export type BillingSubscription =
  | { id: string; state: "charge_capable" }
  | { id: string; state: "terminal" };

export const BillingSubscription = {
  canProduceFutureCharge(subscription: BillingSubscription): boolean {
    return subscription.state === "charge_capable";
  },
} as const;

export type BillingCheckout =
  | {
      id: string;
      productKey: BillingProductKey;
      state: "reusable";
      url: string;
      expiresAt: Date;
    }
  | {
      id: string;
      productKey: BillingProductKey;
      state: "confirmation_pending";
      expiresAt: Date;
    };

export const BillingCheckout = {
  isReusable(
    checkout: BillingCheckout,
  ): checkout is Extract<BillingCheckout, { state: "reusable" }> {
    return checkout.state === "reusable";
  },
  isConfirmationPending(
    checkout: BillingCheckout,
  ): checkout is Extract<BillingCheckout, { state: "confirmation_pending" }> {
    return checkout.state === "confirmation_pending";
  },
} as const;

export type BillingAccountState = "none" | "active" | "needs_attention";

export type BillingSubscriptionReader = {
  listSubscriptions(userId: string): Promise<readonly BillingSubscription[]>;
};

export type BillingCheckoutReader = {
  listOutstandingCheckouts(userId: string): Promise<readonly BillingCheckout[]>;
};

export type BillingEntitlementReader = {
  hasActiveSubscription(userId: string): Promise<boolean>;
};

export type BillingAccountReader = {
  getAccountState(userId: string): Promise<BillingAccountState>;
};

export type BillingSubscriptionRevoker = {
  revokeSubscription(subscriptionId: string): Promise<void>;
};

export type BillingCheckoutCreator = {
  createCheckout(input: {
    userId: string;
    productKey: BillingProductKey;
    termsVersion: string;
    termsAcceptedAt: Date;
  }): Promise<BillingCheckout>;
};

export type SubscriptionCheckoutBilling = BillingSubscriptionReader &
  BillingCheckoutReader &
  BillingCheckoutCreator;

export type AccountDeletionBilling = BillingSubscriptionReader &
  BillingCheckoutReader &
  BillingSubscriptionRevoker;

export type AccountBillingGateway = SubscriptionCheckoutBilling &
  AccountDeletionBilling &
  BillingEntitlementReader &
  BillingAccountReader;
import type { BillingProductKey } from "~/server/billing/product-catalog";
