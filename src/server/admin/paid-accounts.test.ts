import { describe, expect, test } from "bun:test";
import { createBillingProductCatalog } from "~/server/billing/product-catalog";
import {
  PAID_ACCOUNTS_PAGE_CAP,
  PaidAccounts,
  type PaidAccountsListInput,
  type PolarSubscriptionRow,
} from "./paid-accounts";

const NOW = new Date("2026-11-22T12:00:00Z");
const catalog = createBillingProductCatalog({
  checkoutProductIds: {
    lite_monthly: "p-lite-m",
    lite_annual: "p-lite-a",
    full_monthly: "p-full-m",
    full_annual: "p-full-a",
  },
  legacyProductId: "p-legacy",
});

function row(
  id: string,
  overrides: Partial<PolarSubscriptionRow> = {},
): PolarSubscriptionRow {
  return {
    id,
    customerId: `customer-${id}`,
    status: "active",
    productId: "p-full-m",
    startedAt: new Date("2026-01-01T00:00:00Z"),
    canceledAt: null,
    endedAt: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

function pages(...items: PolarSubscriptionRow[][]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const page of items) yield { result: { items: page } };
    },
  };
}

describe("PaidAccounts.read", () => {
  test("counts active accounts by plan and lists the last 30 days of changes", async () => {
    const calls: PaidAccountsListInput[] = [];
    const snapshot = await PaidAccounts.read(
      {
        listSubscriptions: async (input) => {
          calls.push(input);
          if (input.active === true) {
            return pages(
              [
                row("a"),
                row("b", { productId: "p-lite-a" }),
                // Two subscriptions of one customer count as one account.
                row("c", { customerId: "customer-a", productId: "p-legacy" }),
              ],
              [
                row("d", {
                  startedAt: new Date("2026-11-20T00:00:00Z"),
                  cancelAtPeriodEnd: true,
                  canceledAt: new Date("2026-11-21T00:00:00Z"),
                }),
              ],
            );
          }
          if (input.canceledAtAfter !== undefined) {
            return pages([
              row("e", {
                status: "canceled",
                productId: "p-lite-m",
                canceledAt: new Date("2026-11-10T00:00:00Z"),
                endedAt: new Date("2026-11-10T00:00:00Z"),
              }),
            ]);
          }
          return pages([
            row("d", {
              startedAt: new Date("2026-11-20T00:00:00Z"),
              cancelAtPeriodEnd: true,
              canceledAt: new Date("2026-11-21T00:00:00Z"),
            }),
            row("f", { startedAt: new Date("2026-10-01T00:00:00Z") }),
          ]);
        },
      },
      catalog,
      NOW,
    );

    const productId = [
      "p-lite-m",
      "p-lite-a",
      "p-full-m",
      "p-full-a",
      "p-legacy",
    ];
    expect(calls).toEqual([
      { productId, active: true, limit: 100 },
      { productId, sorting: ["-started_at"], limit: 20 },
      {
        productId,
        canceledAtAfter: new Date("2026-10-23T12:00:00Z"),
        limit: 100,
      },
    ]);
    expect(snapshot).toEqual({
      accounts: 3,
      byPlan: {
        lite_monthly: 0,
        lite_annual: 1,
        full_monthly: 2,
        full_annual: 0,
        legacy: 1,
      },
      cancellingAtPeriodEnd: 1,
      changes: [
        {
          at: Date.parse("2026-11-21T00:00:00Z"),
          kind: "cancelled",
          plan: "full_monthly",
        },
        {
          at: Date.parse("2026-11-20T00:00:00Z"),
          kind: "started",
          plan: "full_monthly",
        },
        {
          at: Date.parse("2026-11-10T00:00:00Z"),
          kind: "cancelled",
          plan: "lite_monthly",
        },
        {
          at: Date.parse("2026-11-10T00:00:00Z"),
          kind: "ended",
          plan: "lite_monthly",
        },
      ],
      complete: true,
      fetchedAt: NOW.getTime(),
    });
  });

  test("stops at the page cap and says the count is incomplete", async () => {
    let served = 0;
    const snapshot = await PaidAccounts.read(
      {
        listSubscriptions: async () => ({
          async *[Symbol.asyncIterator]() {
            for (;;) {
              served++;
              yield { result: { items: [row(`s${served}`)] } };
            }
          },
        }),
      },
      catalog,
      NOW,
    );
    // The cap applies to the active list; the other two read one page each.
    expect(served).toBe(PAID_ACCOUNTS_PAGE_CAP + 2);
    expect(snapshot.complete).toBe(false);
  });
});
