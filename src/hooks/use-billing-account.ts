"use client";

import { useMemo } from "react";
import type { PaidPlanTier } from "~/lib/plans";
import type { BillingAccountOverview } from "~/server/billing";
import { api } from "~/trpc/react";

export type BillingAccountState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "none" }
  | { kind: "active"; tier: PaidPlanTier }
  | { kind: "needs_attention" };

export function useBillingAccount(
  options: {
    enabled?: boolean;
    refetchInterval?: (
      overview: BillingAccountOverview | undefined,
    ) => number | false;
  } = {},
) {
  const query = api.subscription.getAccountOverview.useQuery(undefined, {
    enabled: options.enabled,
    refetchInterval: options.refetchInterval
      ? (result) => options.refetchInterval?.(result.state.data) ?? false
      : false,
    retry: false,
  });
  const state = useMemo<BillingAccountState>(() => {
    if (query.isLoading) return { kind: "loading" };
    if (query.isError || !query.data || query.data.kind === "unrecognized") {
      return { kind: "unavailable" };
    }
    return query.data;
  }, [query.data, query.isError, query.isLoading]);

  return { state, retry: query.refetch };
}
