import { describe, expect, test } from "bun:test";
import { type LibSQLDatabase } from "drizzle-orm/libsql";
import { deleteAccountSafely } from "./account-deletion";
import { claimCheckoutBillingOperation } from "./billing-operation";
import { type AccountDeletionBilling } from "./billing";
import { createBillingTestDatabase as testDatabase } from "./test-support/billing-database";

const NOW = new Date("2026-08-24T18:00:00.000Z");

function billingGateway(
  overrides: Partial<AccountDeletionBilling> = {},
): AccountDeletionBilling {
  return {
    listSubscriptions: async () => [],
    listOutstandingCheckouts: async () => [],
    revokeSubscription: async () => {},
    ...overrides,
  };
}

function deletionInput(
  database: LibSQLDatabase,
  overrides: {
    billing?: AccountDeletionBilling;
    deleteLocalAccount?: (userId: string) => Promise<void>;
  } = {},
) {
  return {
    database,
    billing: overrides.billing ?? billingGateway(),
    userId: "user-1",
    now: NOW,
    claimToken: "deletion",
    deleteLocalAccount: overrides.deleteLocalAccount ?? (async () => {}),
  };
}

describe("safe account deletion coordinator", () => {
  test("revokes every charge-capable status before deleting locally", async () => {
    const { client, database } = await testDatabase();
    const events: string[] = [];

    try {
      const result = await deleteAccountSafely(
        deletionInput(database, {
          billing: billingGateway({
            listSubscriptions: async () => [
              { id: "active", state: "charge_capable" },
              { id: "past-due", state: "charge_capable" },
              { id: "unpaid", state: "terminal" },
              { id: "incomplete", state: "charge_capable" },
              { id: "canceled", state: "terminal" },
            ],
            revokeSubscription: async (id) => {
              events.push(`revoke:${id}`);
            },
          }),
          deleteLocalAccount: async () => {
            events.push("delete-local");
          },
        }),
      );

      expect(result).toEqual({
        status: "deleted",
        revokedSubscriptionIds: ["active", "past-due", "incomplete"],
      });
      expect(events.slice(0, -1).sort()).toEqual([
        "revoke:active",
        "revoke:incomplete",
        "revoke:past-due",
      ]);
      expect(events.at(-1)).toBe("delete-local");
    } finally {
      client.close();
    }
  });

  test("does not inspect billing while checkout owns the account", async () => {
    const { client, database } = await testDatabase();
    let billingCalled = false;

    try {
      await claimCheckoutBillingOperation({
        database,
        userId: "user-1",
        token: "checkout",
        now: NOW,
      });

      const result = await deleteAccountSafely(
        deletionInput(database, {
          billing: billingGateway({
            listSubscriptions: async () => {
              billingCalled = true;
              return [];
            },
          }),
        }),
      );

      expect(result).toMatchObject({
        status: "blocked",
        reason: "checkout_in_progress",
      });
      expect(billingCalled).toBe(false);
    } finally {
      client.close();
    }
  });

  test("preserves the account and releases the claim when lookup fails", async () => {
    const { client, database } = await testDatabase();
    const cause = new Error("Polar unavailable");
    let deleted = false;

    try {
      const result = await deleteAccountSafely(
        deletionInput(database, {
          billing: billingGateway({
            listSubscriptions: async () => {
              throw cause;
            },
          }),
          deleteLocalAccount: async () => {
            deleted = true;
          },
        }),
      );

      expect(result).toMatchObject({
        status: "blocked",
        reason: "billing_lookup_failed",
        cause,
      });
      expect(deleted).toBe(false);

      await expect(
        claimCheckoutBillingOperation({
          database,
          userId: "user-1",
          token: "checkout",
          now: NOW,
        }),
      ).resolves.toMatchObject({ status: "claimed" });
    } finally {
      client.close();
    }
  });

  test("records an outstanding checkout when deletion discovers one", async () => {
    const { client, database } = await testDatabase();
    const expiresAt = new Date("2026-08-25T00:00:00.000Z");
    let revoked = false;
    let deleted = false;

    try {
      const result = await deleteAccountSafely(
        deletionInput(database, {
          billing: billingGateway({
            listSubscriptions: async () => [
              { id: "sub", state: "charge_capable" },
            ],
            listOutstandingCheckouts: async () => [
              {
                id: "checkout",
                url: "https://checkout.example",
                expiresAt,
                state: "reusable",
              },
            ],
            revokeSubscription: async () => {
              revoked = true;
            },
          }),
          deleteLocalAccount: async () => {
            deleted = true;
          },
        }),
      );

      expect(result).toMatchObject({
        status: "blocked",
        reason: "open_checkout",
        retryAt: expiresAt,
      });
      expect(revoked).toBe(false);
      expect(deleted).toBe(false);

      await expect(
        claimCheckoutBillingOperation({
          database,
          userId: "user-1",
          token: "checkout",
          now: NOW,
        }),
      ).resolves.toMatchObject({ status: "claimed" });
    } finally {
      client.close();
    }
  });

  test("attempts every revocation and reports each failed subscription", async () => {
    const { client, database } = await testDatabase();
    const attempted: string[] = [];
    let deleted = false;

    try {
      const result = await deleteAccountSafely(
        deletionInput(database, {
          billing: billingGateway({
            listSubscriptions: async () => [
              { id: "sub-1", state: "charge_capable" },
              { id: "sub-2", state: "charge_capable" },
              { id: "sub-3", state: "charge_capable" },
            ],
            revokeSubscription: async (id) => {
              attempted.push(id);
              if (id !== "sub-1") throw new Error("Polar unavailable");
            },
          }),
          deleteLocalAccount: async () => {
            deleted = true;
          },
        }),
      );

      expect(attempted.sort()).toEqual(["sub-1", "sub-2", "sub-3"]);
      expect(result).toMatchObject({
        status: "blocked",
        reason: "subscription_revocation_failed",
        revokedSubscriptionIds: ["sub-1"],
        failedSubscriptionIds: ["sub-2", "sub-3"],
      });
      expect(deleted).toBe(false);
    } finally {
      client.close();
    }
  });

  test("reports local deletion failure after subscriptions are revoked", async () => {
    const { client, database } = await testDatabase();
    const cause = new Error("database unavailable");

    try {
      const result = await deleteAccountSafely(
        deletionInput(database, {
          billing: billingGateway({
            listSubscriptions: async () => [
              { id: "sub", state: "charge_capable" },
            ],
          }),
          deleteLocalAccount: async () => {
            throw cause;
          },
        }),
      );

      expect(result).toMatchObject({
        status: "blocked",
        reason: "local_deletion_failed",
        revokedSubscriptionIds: ["sub"],
        cause,
      });
    } finally {
      client.close();
    }
  });
});
