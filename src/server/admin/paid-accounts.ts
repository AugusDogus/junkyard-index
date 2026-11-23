import type {
  BillingProductCatalog,
  BillingProductKey,
} from "~/server/billing/product-catalog";

/** Days of plan changes the analytics page lists. */
export const PAID_CHANGE_DAYS = 30;
export const PAID_CHANGES_SHOWN = 20;
/** Pages of 100 active subscriptions read at most. */
export const PAID_ACCOUNTS_PAGE_CAP = 10;
const PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A plan: a checkout product, or the grandfathered legacy product (Full). */
export type PaidPlan = BillingProductKey | "legacy";

export type PaidChange = {
  /** Epoch ms. */
  at: number;
  kind: "started" | "cancelled" | "ended";
  plan: PaidPlan;
};

/**
 * Paid plans from Polar, which holds every subscription (the database
 * keeps none). Plain JSON so it can sit in the Next.js data cache. No
 * customer names or emails.
 */
export type PaidSnapshot = {
  /** Customers with at least one active subscription. */
  accounts: number;
  /** Active subscriptions per plan. */
  byPlan: Record<PaidPlan, number>;
  /** Active, but set to end when the paid period does. */
  cancellingAtPeriodEnd: number;
  /** Newest first. */
  changes: PaidChange[];
  /** False when the page cap stopped the active list early. */
  complete: boolean;
  fetchedAt: number;
};

/** The subscription fields read; Polar's SDK type has them all. */
export type PolarSubscriptionRow = {
  id: string;
  customerId: string;
  status: string;
  productId: string;
  startedAt: Date | null;
  canceledAt: Date | null;
  endedAt: Date | null;
  cancelAtPeriodEnd: boolean;
};

export type PaidAccountsListInput = {
  productId: string[];
  limit: number;
  active?: boolean;
  canceledAtAfter?: Date;
  sorting?: "-started_at"[];
};

export type PaidAccountsOperations = {
  listSubscriptions(
    input: PaidAccountsListInput,
  ): Promise<
    AsyncIterable<{ result: { items: readonly PolarSubscriptionRow[] } }>
  >;
};

async function collect(
  pages: AsyncIterable<{ result: { items: readonly PolarSubscriptionRow[] } }>,
  cap: number,
): Promise<{ items: PolarSubscriptionRow[]; complete: boolean }> {
  const items: PolarSubscriptionRow[] = [];
  let read = 0;
  for await (const page of pages) {
    items.push(...page.result.items);
    read++;
    if (read >= cap) return { items, complete: false };
  }
  return { items, complete: true };
}

export const PaidAccounts = {
  /**
   * Active subscriptions (up to the page cap), the 20 newest starts and
   * cancellations in the last 30 days, all for this site's products.
   */
  async read(
    operations: PaidAccountsOperations,
    catalog: BillingProductCatalog,
    now: Date,
  ): Promise<PaidSnapshot> {
    const productId = [...catalog.productById.keys()];
    const since = new Date(now.getTime() - PAID_CHANGE_DAYS * DAY_MS);
    const [active, newest, cancelled] = await Promise.all([
      operations
        .listSubscriptions({ productId, active: true, limit: PAGE_SIZE })
        .then((pages) => collect(pages, PAID_ACCOUNTS_PAGE_CAP)),
      operations
        .listSubscriptions({
          productId,
          sorting: ["-started_at"],
          limit: PAID_CHANGES_SHOWN,
        })
        .then((pages) => collect(pages, 1)),
      operations
        .listSubscriptions({
          productId,
          canceledAtAfter: since,
          limit: PAGE_SIZE,
        })
        .then((pages) => collect(pages, 1)),
    ]);

    const planOf = (subscription: PolarSubscriptionRow): PaidPlan | null => {
      const product = catalog.productById.get(subscription.productId);
      if (product === undefined) return null;
      return product.kind === "legacy" ? "legacy" : product.key;
    };

    const byPlan: Record<PaidPlan, number> = {
      lite_monthly: 0,
      lite_annual: 0,
      full_monthly: 0,
      full_annual: 0,
      legacy: 0,
    };
    const customers = new Set<string>();
    let cancellingAtPeriodEnd = 0;
    for (const subscription of active.items) {
      const plan = planOf(subscription);
      if (plan === null) continue;
      byPlan[plan]++;
      customers.add(subscription.customerId);
      if (subscription.cancelAtPeriodEnd) cancellingAtPeriodEnd++;
    }

    const seen = new Map<string, PolarSubscriptionRow>();
    for (const subscription of [
      ...active.items,
      ...newest.items,
      ...cancelled.items,
    ]) {
      if (!seen.has(subscription.id)) seen.set(subscription.id, subscription);
    }
    const changes: PaidChange[] = [];
    for (const subscription of seen.values()) {
      const plan = planOf(subscription);
      if (plan === null) continue;
      const events = [
        ["started", subscription.startedAt],
        ["cancelled", subscription.canceledAt],
        ["ended", subscription.endedAt],
      ] as const;
      for (const [kind, date] of events) {
        if (date !== null && date >= since) {
          changes.push({ at: date.getTime(), kind, plan });
        }
      }
    }
    changes.sort((a, b) => b.at - a.at);

    return {
      accounts: customers.size,
      byPlan,
      cancellingAtPeriodEnd,
      changes: changes.slice(0, PAID_CHANGES_SHOWN),
      complete: active.complete,
      fetchedAt: now.getTime(),
    };
  },
} as const;
