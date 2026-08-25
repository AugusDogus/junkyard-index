import { describe, expect, test } from "bun:test";
import {
  createPolarBillingGateway,
  type PolarBillingOperations,
} from "./polar-billing";
import { createBillingProductCatalog } from "./billing/product-catalog";

async function* pages<T>(...items: readonly (readonly T[])[]) {
  for (const pageItems of items) {
    yield { result: { items: pageItems } };
  }
}

describe("Polar billing gateway", () => {
  test("collects every subscription page without the active-only filter", async () => {
    const requests: Array<{
      externalCustomerId: string;
      productId?: string | string[];
      limit: number;
    }> = [];
    const operations = operationsWith({
      listSubscriptions: async (input) => {
        requests.push(input);
        return pages(
          [{ id: "active", status: "active", productId: "product-1" }],
          [
            {
              id: "past-due",
              status: "past_due",
              productId: "legacy-product",
            },
          ],
        );
      },
    });
    const gateway = createPolarBillingGateway(operations, config);

    await expect(gateway.listSubscriptions("user-1")).resolves.toEqual([
      { id: "active", state: "charge_capable" },
      { id: "past-due", state: "charge_capable" },
    ]);
    expect(requests).toEqual([
      {
        externalCustomerId: "user-1",
        productId: APPLICATION_PRODUCT_IDS,
        limit: 100,
      },
    ]);
  });

  test("normalizes terminal subscription states at the provider boundary", async () => {
    const gateway = createPolarBillingGateway(
      operationsWith({
        listSubscriptions: async () =>
          pages([
            { id: "canceled", status: "canceled", productId: "product-1" },
            {
              id: "expired",
              status: "incomplete_expired",
              productId: "product-1",
            },
            { id: "unpaid", status: "unpaid", productId: "product-1" },
          ]),
      }),
      config,
    );

    await expect(gateway.listSubscriptions("user-1")).resolves.toEqual([
      { id: "canceled", state: "terminal" },
      { id: "expired", state: "terminal" },
      { id: "unpaid", state: "terminal" },
    ]);
  });

  test("ignores subscriptions and checkouts for unrelated products", async () => {
    const gateway = createPolarBillingGateway(
      operationsWith({
        listSubscriptions: async () =>
          pages([
            {
              id: "app-subscription",
              status: "active",
              productId: "product-1",
            },
            {
              id: "other-subscription",
              status: "active",
              productId: "other-product",
            },
          ]),
        listCheckouts: async () =>
          pages([
            {
              id: "app-checkout",
              url: "https://checkout.example/app",
              expiresAt: new Date("2026-08-25T00:00:00.000Z"),
              status: "open",
              productId: "product-1",
            },
            {
              id: "other-checkout",
              url: "https://checkout.example/other",
              expiresAt: new Date("2026-08-25T00:00:00.000Z"),
              status: "open",
              productId: "other-product",
            },
          ]),
      }),
      config,
    );

    await expect(gateway.listSubscriptions("user-1")).resolves.toEqual([
      { id: "app-subscription", state: "charge_capable" },
    ]);
    await expect(gateway.listOutstandingCheckouts("user-1")).resolves.toEqual([
      {
        id: "app-checkout",
        productKey: "full_monthly",
        state: "reusable",
        url: "https://checkout.example/app",
        expiresAt: new Date("2026-08-25T00:00:00.000Z"),
      },
    ]);
  });

  test("queries every checkout state that can still complete", async () => {
    const requests: Array<{
      customerId: string;
      productId?: string | string[];
      status: Array<"open" | "confirmed">;
      limit: number;
    }> = [];
    const operations = operationsWith({
      listCheckouts: async (input) => {
        requests.push(input);
        return pages([
          {
            id: "checkout",
            url: "https://checkout.example",
            expiresAt: new Date("2026-08-25T00:00:00.000Z"),
            status: "open" as const,
            productId: "product-1",
          },
          {
            id: "legacy-checkout",
            url: "https://checkout.example/legacy",
            expiresAt: new Date("2026-08-25T01:00:00.000Z"),
            status: "open" as const,
            productId: "legacy-product",
          },
        ]);
      },
    });
    const gateway = createPolarBillingGateway(operations, config);

    await expect(gateway.listOutstandingCheckouts("user-1")).resolves.toEqual([
      {
        id: "checkout",
        productKey: "full_monthly",
        state: "reusable",
        url: "https://checkout.example",
        expiresAt: new Date("2026-08-25T00:00:00.000Z"),
      },
      {
        id: "legacy-checkout",
        productKey: null,
        state: "reusable",
        url: "https://checkout.example/legacy",
        expiresAt: new Date("2026-08-25T01:00:00.000Z"),
      },
    ]);

    expect(requests).toEqual([
      {
        customerId: "customer-1",
        productId: APPLICATION_PRODUCT_IDS,
        status: ["open", "confirmed"],
        limit: 100,
      },
    ]);
  });

  test("constructs checkout metadata and URLs at the server boundary", async () => {
    const requests: Parameters<PolarBillingOperations["createCheckout"]>[0][] =
      [];
    const operations = operationsWith({
      createCheckout: async (input) => {
        requests.push(input);
        return {
          id: "checkout",
          url: "https://checkout.example",
          expiresAt: new Date("2026-08-25T00:00:00.000Z"),
          status: "open",
          productId: "product-1",
        };
      },
    });
    const gateway = createPolarBillingGateway(operations, config);

    await gateway.createCheckout({
      userId: "user-1",
      productKey: "full_monthly",
      termsVersion: "2026-08-24",
      termsAcceptedAt: new Date("2026-08-24T12:00:00.000Z"),
    });

    expect(requests).toEqual([
      {
        externalCustomerId: "user-1",
        products: ["product-1"],
        successUrl: "https://app.example/search?subscription=success",
        returnUrl: "https://app.example/subscribe?tier=full&interval=monthly",
        metadata: {
          terms_version: "2026-08-24",
          terms_accepted_at: "2026-08-24T12:00:00.000Z",
        },
      },
    ]);
  });

  test("reports active entitlement separately from manageable billing", async () => {
    const gateway = createPolarBillingGateway(
      operationsWith({
        getCustomerState: async () => ({
          id: "customer-1",
          activeSubscriptions: [],
        }),
        listSubscriptions: async () =>
          pages([
            { id: "past-due", status: "past_due", productId: "product-1" },
          ]),
      }),
      config,
    );

    await expect(gateway.getAccountOverview("user-1")).resolves.toEqual({
      kind: "needs_attention",
    });
  });

  test("reports active subscriptions for other products as unrecognized", async () => {
    const gateway = createPolarBillingGateway(
      operationsWith({
        getCustomerState: async () => ({
          id: "customer-1",
          activeSubscriptions: [{ productId: "another-product" }],
        }),
      }),
      config,
    );

    await expect(gateway.getAccountOverview("user-1")).resolves.toEqual({
      kind: "unrecognized",
    });
  });

  test("recognizes every configured tier product and enumerates all customer subscriptions", async () => {
    let subscriptionLists = 0;
    const gateway = createPolarBillingGateway(
      operationsWith({
        getCustomerState: async () => ({
          id: "customer-1",
          activeSubscriptions: [{ productId: "product-2" }],
        }),
        listSubscriptions: async () => {
          subscriptionLists += 1;
          return pages([
            { id: "subscription-1", status: "active", productId: "product-2" },
          ]);
        },
      }),
      {
        catalog: createBillingProductCatalog({
          checkoutProductIds: {
            lite_monthly: "product-1",
            lite_annual: "product-lite-annual",
            full_monthly: "product-2",
            full_annual: "product-full-annual",
          },
        }),
        appUrl: "https://app.example",
      },
    );

    await expect(gateway.getAccountOverview("user-1")).resolves.toEqual({
      kind: "active",
      tier: "full",
    });
    await expect(gateway.listSubscriptions("user-1")).resolves.toHaveLength(1);
    expect(subscriptionLists).toBe(1);
  });

  test("does not require subscription enumeration for active entitlement", async () => {
    let subscriptionsListed = false;
    const gateway = createPolarBillingGateway(
      operationsWith({
        getCustomerState: async () => ({
          id: "customer-1",
          activeSubscriptions: [{ productId: "product-1" }],
        }),
        listSubscriptions: async () => {
          subscriptionsListed = true;
          throw new Error("subscription list unavailable");
        },
      }),
      config,
    );

    await expect(gateway.getAccountOverview("user-1")).resolves.toEqual({
      kind: "active",
      tier: "full",
    });
    expect(subscriptionsListed).toBe(false);
  });
});

const config = {
  catalog: createBillingProductCatalog({
    checkoutProductIds: {
      lite_monthly: "product-lite-monthly",
      lite_annual: "product-lite-annual",
      full_monthly: "product-1",
      full_annual: "product-full-annual",
    },
    legacyProductId: "legacy-product",
  }),
  appUrl: "https://app.example",
};

const APPLICATION_PRODUCT_IDS = [
  "product-lite-monthly",
  "product-lite-annual",
  "product-1",
  "product-full-annual",
  "legacy-product",
];

function operationsWith(
  overrides: Partial<PolarBillingOperations>,
): PolarBillingOperations {
  return {
    listSubscriptions: async () => pages([]),
    revokeSubscription: async () => {},
    getCustomerState: async () => ({
      id: "customer-1",
      activeSubscriptions: [],
    }),
    listCheckouts: async () => pages([]),
    createCheckout: async () => ({
      id: "checkout",
      url: "https://checkout.example",
      expiresAt: new Date("2026-08-25T00:00:00.000Z"),
      status: "open",
      productId: "product-1",
    }),
    ...overrides,
  };
}
