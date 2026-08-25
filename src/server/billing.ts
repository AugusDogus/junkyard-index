import type { BillingAccountOverview } from "~/lib/billing-account";
import type { BillingProductKey } from "~/server/billing/product-catalog";

export type { BillingProductKey } from "~/server/billing/product-catalog";
export type { BillingAccountOverview } from "~/lib/billing-account";

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
      productKey: BillingProductKey | null;
      state: "reusable";
      url: string;
      expiresAt: Date;
    }
  | {
      id: string;
      productKey: BillingProductKey | null;
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

export type BillingSubscriptionReader = {
  listSubscriptions(userId: string): Promise<readonly BillingSubscription[]>;
};

export type BillingCheckoutReader = {
  listOutstandingCheckouts(userId: string): Promise<readonly BillingCheckout[]>;
};

export type BillingAccountReader = {
  getAccountOverview(userId: string): Promise<BillingAccountOverview>;
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
  BillingAccountReader;
