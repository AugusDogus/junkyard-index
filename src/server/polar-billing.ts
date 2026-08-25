import {
  type AccountBillingGateway,
  type BillingCheckout,
  BillingSubscription,
  type BillingSubscription as DomainBillingSubscription,
} from "~/server/billing";

type PolarPage<T> = {
  result: { items: readonly T[] };
};

type PolarSubscription = { id: string; status: string };
type PolarCheckout = {
  id: string;
  url: string;
  expiresAt: Date;
  status: string;
};

export type PolarBillingOperations = {
  listSubscriptions(input: {
    externalCustomerId: string;
    productId: string;
    limit: number;
  }): Promise<AsyncIterable<PolarPage<PolarSubscription>>>;
  revokeSubscription(input: { id: string }): Promise<unknown>;
  getCustomerState(input: { externalId: string }): Promise<{
    id: string;
    activeSubscriptions: readonly { productId: string }[];
  }>;
  listCheckouts(input: {
    customerId: string;
    productId: string;
    status: Array<"open" | "confirmed">;
    limit: number;
  }): Promise<AsyncIterable<PolarPage<PolarCheckout>>>;
  createCheckout(input: {
    externalCustomerId: string;
    products: string[];
    successUrl: string;
    returnUrl: string;
    metadata: {
      terms_version: string;
      terms_accepted_at: string;
    };
  }): Promise<PolarCheckout>;
};

function normalizeSubscription(
  subscription: PolarSubscription,
): DomainBillingSubscription {
  switch (subscription.status) {
    case "canceled":
    case "incomplete_expired":
    case "unpaid":
      return { id: subscription.id, state: "terminal" };
    case "active":
    case "incomplete":
    case "past_due":
    case "trialing":
      return { id: subscription.id, state: "charge_capable" };
    default:
      throw new Error(
        `Polar subscription ${subscription.id} has unrecognized status ${subscription.status}.`,
      );
  }
}

function normalizeOutstandingCheckout(
  checkout: PolarCheckout,
): BillingCheckout | null {
  switch (checkout.status) {
    case "open":
      return {
        id: checkout.id,
        state: "reusable",
        url: checkout.url,
        expiresAt: checkout.expiresAt,
      };
    case "confirmed":
      return {
        id: checkout.id,
        state: "confirmation_pending",
        expiresAt: checkout.expiresAt,
      };
    case "expired":
    case "failed":
    case "succeeded":
      return null;
    default:
      throw new Error(
        `Polar checkout ${checkout.id} has unrecognized status ${checkout.status}.`,
      );
  }
}

export function createPolarBillingGateway(
  operations: PolarBillingOperations,
  config: {
    productIds: readonly string[];
    checkoutProductId: string;
    appUrl: string;
  },
): AccountBillingGateway {
  const listSubscriptions = async (
    userId: string,
  ): Promise<readonly DomainBillingSubscription[]> => {
    const subscriptions: DomainBillingSubscription[] = [];
    for (const productId of config.productIds) {
      const pages = await operations.listSubscriptions({
        externalCustomerId: userId,
        productId,
        limit: 100,
      });
      for await (const page of pages) {
        subscriptions.push(...page.result.items.map(normalizeSubscription));
      }
    }

    return subscriptions;
  };

  return {
    listSubscriptions,
    listOutstandingCheckouts: async (userId) => {
      const customer = await operations.getCustomerState({
        externalId: userId,
      });
      const checkouts: PolarCheckout[] = [];
      for (const productId of config.productIds) {
        const pages = await operations.listCheckouts({
          customerId: customer.id,
          productId,
          status: ["open", "confirmed"],
          limit: 100,
        });
        for await (const page of pages) {
          checkouts.push(...page.result.items);
        }
      }

      return checkouts.flatMap((checkout) => {
        const normalized = normalizeOutstandingCheckout(checkout);
        return normalized ? [normalized] : [];
      });
    },
    hasActiveSubscription: async (userId) => {
      const customer = await operations.getCustomerState({
        externalId: userId,
      });
      return customer.activeSubscriptions.some(({ productId }) =>
        config.productIds.includes(productId),
      );
    },
    getAccountState: async (userId) => {
      const customer = await operations.getCustomerState({
        externalId: userId,
      });
      if (
        customer.activeSubscriptions.some(({ productId }) =>
          config.productIds.includes(productId),
        )
      ) {
        return "active";
      }

      const subscriptions = await listSubscriptions(userId);
      return subscriptions.some(BillingSubscription.canProduceFutureCharge)
        ? "needs_attention"
        : "none";
    },
    revokeSubscription: async (subscriptionId) => {
      await operations.revokeSubscription({ id: subscriptionId });
    },
    createCheckout: async ({ userId, termsVersion, termsAcceptedAt }) => {
      const checkout = await operations.createCheckout({
        externalCustomerId: userId,
        products: [config.checkoutProductId],
        successUrl: `${config.appUrl}/search?subscription=success`,
        returnUrl: `${config.appUrl}/subscribe`,
        metadata: {
          terms_version: termsVersion,
          terms_accepted_at: termsAcceptedAt.toISOString(),
        },
      });

      const normalized = normalizeOutstandingCheckout(checkout);
      if (!normalized) {
        throw new Error(
          `Polar created checkout ${checkout.id} with unexpected status ${checkout.status}.`,
        );
      }

      return normalized;
    },
  };
}
