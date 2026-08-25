import {
  type AccountBillingGateway,
  type BillingCheckout,
  BillingSubscription,
  type BillingSubscription as DomainBillingSubscription,
} from "~/server/billing";
import type {
  BillingProductKey,
  CheckoutBillingProduct,
} from "~/server/billing/product-catalog";

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
    productId?: string;
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
  productKey: BillingProductKey,
): BillingCheckout | null {
  switch (checkout.status) {
    case "open":
      return {
        id: checkout.id,
        productKey,
        state: "reusable",
        url: checkout.url,
        expiresAt: checkout.expiresAt,
      };
    case "confirmed":
      return {
        id: checkout.id,
        productKey,
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
    products: readonly CheckoutBillingProduct[];
    recognizedProductIds?: readonly string[];
    appUrl: string;
  },
): AccountBillingGateway {
  const listSubscriptions = async (
    userId: string,
  ): Promise<readonly DomainBillingSubscription[]> => {
    const subscriptions: DomainBillingSubscription[] = [];
    const pages = await operations.listSubscriptions({
      externalCustomerId: userId,
      limit: 100,
    });
    for await (const page of pages) {
      subscriptions.push(...page.result.items.map(normalizeSubscription));
    }

    return subscriptions;
  };
  const recognizedProductIds =
    config.recognizedProductIds ??
    config.products.map(({ productId }) => productId);

  return {
    listSubscriptions,
    listOutstandingCheckouts: async (userId) => {
      const customer = await operations.getCustomerState({
        externalId: userId,
      });
      const groups = await Promise.all(
        config.products.map(async ({ key, productId }) => {
          const pages = await operations.listCheckouts({
            customerId: customer.id,
            productId,
            status: ["open", "confirmed"],
            limit: 100,
          });
          const checkouts: PolarCheckout[] = [];
          for await (const page of pages) checkouts.push(...page.result.items);
          return checkouts.map((checkout) => ({ checkout, key }));
        }),
      );

      return groups.flat().flatMap(({ checkout, key }) => {
        const normalized = normalizeOutstandingCheckout(checkout, key);
        return normalized ? [normalized] : [];
      });
    },
    hasActiveSubscription: async (userId) => {
      const customer = await operations.getCustomerState({
        externalId: userId,
      });
      return customer.activeSubscriptions.some(({ productId }) =>
        recognizedProductIds.includes(productId),
      );
    },
    getAccountState: async (userId) => {
      const customer = await operations.getCustomerState({
        externalId: userId,
      });
      if (
        customer.activeSubscriptions.some(({ productId }) =>
          recognizedProductIds.includes(productId),
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
    createCheckout: async ({
      userId,
      productKey,
      termsVersion,
      termsAcceptedAt,
    }) => {
      const product = config.products.find(({ key }) => key === productKey);
      if (!product)
        throw new Error(`Billing product ${productKey} is not configured.`);
      const checkout = await operations.createCheckout({
        externalCustomerId: userId,
        products: [product.productId],
        successUrl: `${config.appUrl}/search?subscription=success`,
        returnUrl: `${config.appUrl}/subscribe?tier=${product.tier}&interval=${product.interval}`,
        metadata: {
          terms_version: termsVersion,
          terms_accepted_at: termsAcceptedAt.toISOString(),
        },
      });

      const normalized = normalizeOutstandingCheckout(checkout, productKey);
      if (!normalized) {
        throw new Error(
          `Polar created checkout ${checkout.id} with unexpected status ${checkout.status}.`,
        );
      }

      return normalized;
    },
  };
}
