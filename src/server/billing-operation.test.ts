import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimCheckoutBillingOperation,
  claimDeletionBillingOperation,
  completeBillingOperationClaim,
  recordCheckoutCompletion,
} from "./billing-operation";
import {
  BILLING_TEST_SCHEMA,
  createBillingTestDatabase as testDatabase,
} from "./test-support/billing-database";

const NOW = new Date("2026-08-24T18:00:00.000Z");

describe("billing operation claims", () => {
  test("serializes claims across independent database connections", async () => {
    const directory = await mkdtemp(join(tmpdir(), "billing-operation-test-"));
    const url = `file:${join(directory, "database.sqlite")}`;
    const firstClient = createClient({ url });
    const secondClient = createClient({ url });
    try {
      await firstClient.executeMultiple(BILLING_TEST_SCHEMA);
      await firstClient.execute("insert into user (id) values ('user-1')");

      const [first, second] = await Promise.all([
        claimCheckoutBillingOperation({
          database: drizzle(firstClient),
          userId: "user-1",
          token: "checkout-a",
          now: NOW,
        }),
        claimCheckoutBillingOperation({
          database: drizzle(secondClient),
          userId: "user-1",
          token: "checkout-b",
          now: NOW,
        }),
      ]);

      expect([first.status, second.status].sort()).toEqual(["busy", "claimed"]);
    } finally {
      firstClient.close();
      secondClient.close();
      await rm(directory, { recursive: true });
    }
  });

  test("allows only one concurrent checkout claim", async () => {
    const { client, database } = await testDatabase();
    try {
      const [first, second] = await Promise.all([
        claimCheckoutBillingOperation({
          database,
          userId: "user-1",
          token: "checkout-a",
          now: NOW,
        }),
        claimCheckoutBillingOperation({
          database,
          userId: "user-1",
          token: "checkout-b",
          now: NOW,
        }),
      ]);

      expect([first.status, second.status].sort()).toEqual(["busy", "claimed"]);
    } finally {
      client.close();
    }
  });

  test("blocks deletion while checkout owns the account", async () => {
    const { client, database } = await testDatabase();
    try {
      await claimCheckoutBillingOperation({
        database,
        userId: "user-1",
        token: "checkout",
        now: NOW,
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

  test("blocks checkout while deletion owns the account", async () => {
    const { client, database } = await testDatabase();
    try {
      await claimDeletionBillingOperation({
        database,
        userId: "user-1",
        token: "deletion",
        now: NOW,
      });

      await expect(
        claimCheckoutBillingOperation({
          database,
          userId: "user-1",
          token: "checkout",
          now: NOW,
        }),
      ).resolves.toMatchObject({
        status: "busy",
        operation: "deleting",
      });
    } finally {
      client.close();
    }
  });

  test("reclaims a recorded open checkout without allowing deletion", async () => {
    const { client, database } = await testDatabase();
    try {
      const initial = await claimCheckoutBillingOperation({
        database,
        userId: "user-1",
        token: "initial",
        now: NOW,
      });
      expect(initial.status).toBe("claimed");
      await completeBillingOperationClaim({
        database,
        userId: "user-1",
        operation: "checkout",
        token: "initial",
        next: {
          operation: "checkout",
          expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
        },
      });

      const reclaimed = await claimCheckoutBillingOperation({
        database,
        userId: "user-1",
        token: "reclaimed",
        now: NOW,
      });
      expect(reclaimed).toMatchObject({
        status: "claimed",
        operation: "checkout",
        token: "reclaimed",
      });

      const deletion = await claimDeletionBillingOperation({
        database,
        userId: "user-1",
        token: "deletion",
        now: NOW,
      });
      expect(deletion).toMatchObject({
        status: "busy",
        operation: "checkout",
      });
    } finally {
      client.close();
    }
  });

  test("lets deletion recover an expired checkout claim", async () => {
    const { client, database } = await testDatabase();
    try {
      await claimCheckoutBillingOperation({
        database,
        userId: "user-1",
        token: "stale-checkout",
        now: new Date(NOW.getTime() - 10 * 60 * 1000),
        leaseMs: 5 * 60 * 1000,
      });

      await expect(
        claimDeletionBillingOperation({
          database,
          userId: "user-1",
          token: "deletion",
          now: NOW,
        }),
      ).resolves.toMatchObject({
        status: "claimed",
        operation: "deleting",
      });
    } finally {
      client.close();
    }
  });

  test("prevents a stale owner from completing another owner's claim", async () => {
    const { client, database } = await testDatabase();
    try {
      await claimCheckoutBillingOperation({
        database,
        userId: "user-1",
        token: "current",
        now: NOW,
      });

      await expect(
        completeBillingOperationClaim({
          database,
          userId: "user-1",
          operation: "checkout",
          token: "stale",
          next: { operation: "idle" },
        }),
      ).resolves.toBe(false);
    } finally {
      client.close();
    }
  });

  test("allows deletion after a subscription webhook clears checkout", async () => {
    const { client, database } = await testDatabase();
    try {
      await claimCheckoutBillingOperation({
        database,
        userId: "user-1",
        token: "checkout",
        now: NOW,
      });
      await completeBillingOperationClaim({
        database,
        userId: "user-1",
        operation: "checkout",
        token: "checkout",
        next: {
          operation: "checkout",
          expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
        },
      });

      await recordCheckoutCompletion({ database, userId: "user-1" });

      await expect(
        claimDeletionBillingOperation({
          database,
          userId: "user-1",
          token: "deletion",
          now: NOW,
        }),
      ).resolves.toMatchObject({
        status: "claimed",
        operation: "deleting",
      });
    } finally {
      client.close();
    }
  });

  test("does not let a webhook clear an active checkout claim", async () => {
    const { client, database } = await testDatabase();
    try {
      await claimCheckoutBillingOperation({
        database,
        userId: "user-1",
        token: "checkout",
        now: NOW,
      });

      await recordCheckoutCompletion({ database, userId: "user-1" });

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
      await expect(
        completeBillingOperationClaim({
          database,
          userId: "user-1",
          operation: "checkout",
          token: "checkout",
          next: { operation: "idle" },
        }),
      ).resolves.toBe(true);
    } finally {
      client.close();
    }
  });

  test("preserves webhook completion across a reused checkout claim", async () => {
    const { client, database } = await testDatabase();
    try {
      await claimCheckoutBillingOperation({
        database,
        userId: "user-1",
        token: "initial",
        now: NOW,
      });
      await completeBillingOperationClaim({
        database,
        userId: "user-1",
        operation: "checkout",
        token: "initial",
        next: {
          operation: "checkout",
          expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
        },
      });
      await claimCheckoutBillingOperation({
        database,
        userId: "user-1",
        token: "reused",
        now: NOW,
      });

      await recordCheckoutCompletion({ database, userId: "user-1" });

      await expect(
        completeBillingOperationClaim({
          database,
          userId: "user-1",
          operation: "checkout",
          token: "reused",
          next: {
            operation: "checkout",
            expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
          },
        }),
      ).resolves.toBe(true);
      await expect(
        claimDeletionBillingOperation({
          database,
          userId: "user-1",
          token: "deletion",
          now: NOW,
        }),
      ).resolves.toMatchObject({ status: "claimed", operation: "deleting" });
    } finally {
      client.close();
    }
  });
});
