import { describe, expect, test } from "bun:test";
import {
  createPolarBillingGateway,
  type PolarBillingOperations,
} from "./polar-billing";

async function* pages<T>(...items: readonly (readonly T[])[]) {
  for (const pageItems of items) {
    yield { result: { items: pageItems } };
  }
}

describe("Polar billing gateway", () => {
  test("collects every subscription page without the active-only filter", async () => {
    const requests: Array<{
      externalCustomerId: string;
      productId: string;
      limit: number;
    }> = [];
    const operations = operationsWith({
      listSubscriptions: async (input) => {
        requests.push(input);
        return pages(
          [{ id: "active", status: "active" }],
          [{ id: "past-due", status: "past_due" }],
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
        productId: "product-1",
        limit: 100,
      },
    ]);
  });

  test("normalizes terminal subscription states at the provider boundary", async () => {
    const gateway = createPolarBillingGateway(
      operationsWith({
        listSubscriptions: async () =>
          pages([
            { id: "canceled", status: "canceled" },
            { id: "expired", status: "incomplete_expired" },
            { id: "unpaid", status: "unpaid" },
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

  test("queries every checkout state that can still complete", async () => {
    const requests: Array<{
      customerId: string;
      productId: string;
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
          },
        ]);
      },
    });
    const gateway = createPolarBillingGateway(operations, config);

    await expect(gateway.listOutstandingCheckouts("user-1")).resolves.toEqual([
      {
        id: "checkout",
        state: "reusable",
        url: "https://checkout.example",
        expiresAt: new Date("2026-08-25T00:00:00.000Z"),
      },
    ]);

    expect(requests).toEqual([
      {
        customerId: "customer-1",
        productId: "product-1",
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
        };
      },
    });
    const gateway = createPolarBillingGateway(operations, config);

    await gateway.createCheckout({
      userId: "user-1",
      termsVersion: "2026-08-24",
      termsAcceptedAt: new Date("2026-08-24T12:00:00.000Z"),
    });

    expect(requests).toEqual([
      {
        externalCustomerId: "user-1",
        products: ["product-1"],
        successUrl: "https://app.example/search?subscription=success",
        returnUrl: "https://app.example/subscribe",
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
          pages([{ id: "past-due", status: "past_due" }]),
      }),
      config,
    );

    await expect(gateway.getAccountState("user-1")).resolves.toBe(
      "needs_attention",
    );
  });

  test("ignores active subscriptions for other products", async () => {
    const gateway = createPolarBillingGateway(
      operationsWith({
        getCustomerState: async () => ({
          id: "customer-1",
          activeSubscriptions: [{ productId: "another-product" }],
        }),
      }),
      config,
    );

    await expect(gateway.hasActiveSubscription("user-1")).resolves.toBe(false);
  });

  test("recognizes and enumerates every configured tier product", async () => {
    const listedProducts: string[] = [];
    const gateway = createPolarBillingGateway(
      operationsWith({
        getCustomerState: async () => ({
          id: "customer-1",
          activeSubscriptions: [{ productId: "product-2" }],
        }),
        listSubscriptions: async ({ productId }) => {
          listedProducts.push(productId);
          return pages([{ id: productId, status: "active" }]);
        },
      }),
      {
        productIds: ["product-1", "product-2"],
        checkoutProductId: "product-2",
        appUrl: "https://app.example",
      },
    );

    await expect(gateway.hasActiveSubscription("user-1")).resolves.toBe(true);
    await expect(gateway.listSubscriptions("user-1")).resolves.toHaveLength(2);
    expect(listedProducts).toEqual(["product-1", "product-2"]);
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

    await expect(gateway.getAccountState("user-1")).resolves.toBe("active");
    expect(subscriptionsListed).toBe(false);
  });
});

const config = {
  productIds: ["product-1"],
  checkoutProductId: "product-1",
  appUrl: "https://app.example",
};

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
    }),
    ...overrides,
  };
}
