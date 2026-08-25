import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { type LibSQLDatabase } from "drizzle-orm/libsql";
import { billingOperation, user } from "~/schema";
import { claimDeletionBillingOperation } from "./billing-operation";
import { type SubscriptionCheckoutBilling } from "./billing";
import { createSubscriptionCheckout } from "./subscription-checkout";
import { createBillingTestDatabase as testDatabase } from "./test-support/billing-database";

const NOW = new Date("2026-08-24T18:00:00.000Z");
const ACCEPTED_AT = new Date("2026-08-24T18:00:01.000Z");
const CHECKOUT_EXPIRATION = new Date("2026-08-25T18:00:00.000Z");

function billingGateway(
  overrides: Partial<SubscriptionCheckoutBilling> = {},
): SubscriptionCheckoutBilling {
  return {
    listSubscriptions: async () => [],
    listOutstandingCheckouts: async () => [],
    createCheckout: async () => ({
      id: "checkout-1",
      productKey: "full_monthly",
      state: "reusable",
      url: "https://checkout.example/checkout-1",
      expiresAt: CHECKOUT_EXPIRATION,
    }),
    ...overrides,
  };
}

function deferred() {
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function checkoutInput(database: LibSQLDatabase, claimToken: string) {
  return {
    database,
    userId: "user-1",
    termsVersion: "2026-08-24",
    termsAcceptedAt: ACCEPTED_AT,
    now: NOW,
    claimToken,
    productKey: "full_monthly" as const,
  };
}

describe("subscription checkout coordinator", () => {
  test("creates only one checkout when requests overlap", async () => {
    const { client, database } = await testDatabase();
    const checkoutStarted = deferred();
    const releaseCheckout = deferred();
    let createCalls = 0;
    const billing = billingGateway({
      createCheckout: async () => {
        createCalls += 1;
        checkoutStarted.resolve();
        await releaseCheckout.promise;
        return {
          id: "checkout-1",
          productKey: "full_monthly",
          state: "reusable",
          url: "https://checkout.example/checkout-1",
          expiresAt: CHECKOUT_EXPIRATION,
        };
      },
    });

    try {
      const first = createSubscriptionCheckout({
        ...checkoutInput(database, "checkout-a"),
        billing,
      });
      await checkoutStarted.promise;

      const second = await createSubscriptionCheckout({
        ...checkoutInput(database, "checkout-b"),
        billing,
      });
      releaseCheckout.resolve();

      await expect(first).resolves.toMatchObject({ status: "ready" });
      expect(second).toEqual({
        status: "blocked",
        reason: "checkout_in_progress",
        retryAt: new Date(NOW.getTime() + 30 * 60 * 1000),
      });
      expect(createCalls).toBe(1);
    } finally {
      releaseCheckout.resolve();
      client.close();
    }
  });

  test("does not call billing while deletion owns the account", async () => {
    const { client, database } = await testDatabase();
    let billingCalled = false;

    try {
      await claimDeletionBillingOperation({
        database,
        userId: "user-1",
        token: "deletion",
        now: NOW,
      });

      const result = await createSubscriptionCheckout({
        ...checkoutInput(database, "checkout"),
        billing: billingGateway({
          listSubscriptions: async () => {
            billingCalled = true;
            return [];
          },
        }),
      });

      expect(result).toEqual({
        status: "blocked",
        reason: "deletion_in_progress",
        retryAt: new Date(NOW.getTime() + 30 * 60 * 1000),
      });
      expect(billingCalled).toBe(false);
    } finally {
      client.close();
    }
  });

  test("records the open checkout and accepted terms", async () => {
    const { client, database } = await testDatabase();

    try {
      await expect(
        createSubscriptionCheckout({
          ...checkoutInput(database, "checkout"),
          billing: billingGateway(),
        }),
      ).resolves.toEqual({
        status: "ready",
        url: "https://checkout.example/checkout-1",
        reused: false,
      });

      const [record] = await database
        .select({
          termsAcceptedAt: user.termsAcceptedAt,
          termsVersion: user.termsVersion,
          operation: billingOperation.state,
          operationToken: billingOperation.token,
          operationExpiresAt: billingOperation.expiresAt,
        })
        .from(user)
        .leftJoin(billingOperation, eq(billingOperation.userId, user.id))
        .where(eq(user.id, "user-1"));

      expect(record).toEqual({
        termsAcceptedAt: ACCEPTED_AT,
        termsVersion: "2026-08-24",
        operation: "checkout_open",
        operationToken: null,
        operationExpiresAt: CHECKOUT_EXPIRATION,
      });
    } finally {
      client.close();
    }
  });

  test("releases the claim after a billing lookup failure", async () => {
    const { client, database } = await testDatabase();
    const cause = new Error("billing unavailable");

    try {
      await expect(
        createSubscriptionCheckout({
          ...checkoutInput(database, "checkout"),
          billing: billingGateway({
            listSubscriptions: async () => {
              throw cause;
            },
          }),
        }),
      ).resolves.toEqual({
        status: "failed",
        reason: "billing_lookup_failed",
        cause,
      });

      await expect(
        claimDeletionBillingOperation({
          database,
          userId: "user-1",
          token: "deletion",
          now: NOW,
        }),
      ).resolves.toMatchObject({ status: "claimed" });
    } finally {
      client.close();
    }
  });

  test("holds deletion after uncertain checkout creation", async () => {
    const { client, database } = await testDatabase();

    try {
      const result = await createSubscriptionCheckout({
        ...checkoutInput(database, "checkout"),
        billing: billingGateway({
          createCheckout: async () => {
            throw new Error("billing timed out");
          },
        }),
      });

      expect(result).toMatchObject({
        status: "failed",
        reason: "checkout_creation_uncertain",
        retryAt: new Date(NOW.getTime() + 15 * 60 * 1000),
      });
      await expect(
        claimDeletionBillingOperation({
          database,
          userId: "user-1",
          token: "deletion",
          now: NOW,
        }),
      ).resolves.toMatchObject({
        status: "busy",
        operation: "checkout",
      });
    } finally {
      client.close();
    }
  });

  test("blocks every charge-capable subscription state", async () => {
    const { client, database } = await testDatabase();
    let checkoutCreated = false;

    try {
      const result = await createSubscriptionCheckout({
        ...checkoutInput(database, "checkout"),
        billing: billingGateway({
          listSubscriptions: async () => [
            { id: "past-due", state: "charge_capable" },
          ],
          createCheckout: async () => {
            checkoutCreated = true;
            throw new Error("should not run");
          },
        }),
      });

      expect(result).toEqual({
        status: "blocked",
        reason: "already_subscribed",
      });
      expect(checkoutCreated).toBe(false);
    } finally {
      client.close();
    }
  });

  test("does not redirect while checkout confirmation is pending", async () => {
    const { client, database } = await testDatabase();

    try {
      await expect(
        createSubscriptionCheckout({
          ...checkoutInput(database, "checkout"),
          billing: billingGateway({
            listOutstandingCheckouts: async () => [
              {
                id: "confirmed",
                productKey: "full_monthly",
                state: "confirmation_pending",
                expiresAt: CHECKOUT_EXPIRATION,
              },
            ],
          }),
        }),
      ).resolves.toEqual({
        status: "blocked",
        reason: "checkout_pending",
        retryAt: CHECKOUT_EXPIRATION,
      });
    } finally {
      client.close();
    }
  });

  test("blocks checkout while a different product checkout remains open", async () => {
    const { client, database } = await testDatabase();
    let checkoutCreated = false;

    try {
      const result = await createSubscriptionCheckout({
        ...checkoutInput(database, "checkout"),
        productKey: "full_monthly",
        billing: billingGateway({
          listOutstandingCheckouts: async () => [
            {
              id: "lite-checkout",
              productKey: "lite_monthly",
              state: "reusable",
              url: "https://checkout.example/lite",
              expiresAt: CHECKOUT_EXPIRATION,
            },
          ],
          createCheckout: async ({ productKey }) => {
            checkoutCreated = true;
            return {
              id: "full-checkout",
              productKey,
              state: "reusable",
              url: "https://checkout.example/full",
              expiresAt: CHECKOUT_EXPIRATION,
            };
          },
        }),
      });

      expect(result).toEqual({
        status: "blocked",
        reason: "checkout_pending",
        retryAt: CHECKOUT_EXPIRATION,
      });
      expect(checkoutCreated).toBe(false);
    } finally {
      client.close();
    }
  });
});
