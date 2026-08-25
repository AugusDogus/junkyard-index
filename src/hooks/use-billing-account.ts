"use client";

import { useMemo } from "react";
import {
  normalizeBillingAccount,
  type BillingAccountState,
} from "~/lib/billing-account";
import { api } from "~/trpc/react";

export function useBillingAccount(
  options: {
    enabled?: boolean;
    refetchInterval?: (state: BillingAccountState) => number | false;
  } = {},
) {
  const query = api.subscription.getAccountOverview.useQuery(undefined, {
    enabled: options.enabled,
    refetchInterval: options.refetchInterval
      ? (result) =>
          options.refetchInterval?.(
            normalizeBillingAccount({
              overview: result.state.data,
              isLoading: result.state.status === "pending",
              isError: result.state.status === "error",
            }),
          ) ?? false
      : false,
    retry: false,
  });
  const state = useMemo(
    () =>
      normalizeBillingAccount({
        overview: query.data,
        isLoading: query.isLoading,
        isError: query.isError,
      }),
    [query.data, query.isError, query.isLoading],
  );

  return { state, retry: query.refetch };
}
