"use client";

import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { signIn, useSession } from "~/lib/auth-client";
import { currentUtcDay } from "~/server/billing/search-quota";
import {
  FREE_DAILY_SEARCH_LIMIT,
  PLANS,
  hasPlanFeature,
  type PlanFeature,
  type PlanTier,
} from "~/lib/plans";
import { isGuestSession } from "~/lib/session-user";
import { api } from "~/trpc/react";

interface InstantSearchUiState {
  refinementList?: Record<string, string[]>;
  range?: Record<string, string>;
}

/** Subscribes to the viewer's plan tier via tRPC. */
export function usePlanTier(isLoggedIn: boolean): {
  /** Resolved plan tier; null means "not known yet", never "free". */
  planTier: PlanTier | null;
  isResolved: boolean;
  isPaid: boolean;
  canUseAdvancedFilters: boolean;
  canSaveSearches: boolean;
  canUseAlerts: boolean;
} {
  const { data } = api.subscription.getCustomerState.useQuery(undefined, {
    enabled: isLoggedIn,
  });
  // Logged-out viewers are free by definition; logged-in users are unknown
  // until the query resolves.
  const planTier: PlanTier | null = isLoggedIn ? (data?.tier ?? null) : "free";

  // Gate semantics for an UNKNOWN tier: optimistically unlocked for signed-in
  // users so paying users never see a flash of upsell UI on first paint, and
  // locked for anonymous visitors who are free by definition. The server is
  // always authoritative, so optimistic gating never grants entitlements.
  const resolveGate = (feature: PlanFeature): boolean =>
    planTier === null ? isLoggedIn : hasPlanFeature(planTier, feature);

  return {
    planTier,
    isResolved: planTier !== null,
    isPaid: planTier !== null && planTier !== "free",
    canUseAdvancedFilters: resolveGate("advanced_filters"),
    canSaveSearches: resolveGate("saved_searches"),
    canUseAlerts: resolveGate("alerts"),
  };
}

interface DailySearchQuotaArgs {
  isLoggedIn: boolean;
  isAnonymousUser: boolean;
  /** Null while the tier query is in flight; treated as free for UX gating
   * (the server always resolves the authoritative tier before counting). */
  planTier: PlanTier | null;
  /** Committed search value; empty string means no active search. */
  analyticsSearchValue: string;
  isSearching: boolean;
  hasError: boolean;
}

/** Last quota-recorded query, its outcome, and the UTC day it counts toward. */
interface QuotaDedupeRecord {
  query: string;
  exceeded: boolean;
  day: string;
}

const QUOTA_DEDUPE_KEY = "ji:quotaDedupe";

function readQuotaDedupe(today: string): QuotaDedupeRecord | null {
  try {
    const raw = window.sessionStorage.getItem(QUOTA_DEDUPE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "query" in parsed &&
      "exceeded" in parsed &&
      "day" in parsed &&
      typeof parsed.query === "string" &&
      typeof parsed.exceeded === "boolean" &&
      typeof parsed.day === "string"
    ) {
      // Records from a previous UTC day are stale: the server-side quota
      // resets at midnight UTC, so a restored block would contradict it.
      if (parsed.day !== today) {
        return null;
      }
      return {
        query: parsed.query,
        exceeded: parsed.exceeded,
        day: parsed.day,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeQuotaDedupe(record: QuotaDedupeRecord): void {
  try {
    window.sessionStorage.setItem(QUOTA_DEDUPE_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable; in-memory dedupe still applies for this mount
  }
}

/**
 * Free-tier daily search quota. Counts each committed search server-side.
 * Guests get an anonymous Better Auth session on their first search so the
 * same server-side quota applies before sign-up; signing up converts the
 * guest in place and carries their usage history over (see auth.ts
 * onLinkAccount). Guest session creation failure fails open rather than
 * blocking search.
 */
export function useDailySearchQuota(args: DailySearchQuotaArgs): boolean {
  const recordSearchMutation = api.usage.recordSearch.useMutation();
  // Dedupe record persists in sessionStorage so a page refresh (or SPA
  // remount) of the same search URL neither re-counts the query nor
  // clears an active quota block.
  const lastQuotaQuery = useRef<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const { data: authSession } = useSession();
  // Derived from the live session (not component state) so the flag survives
  // InstantSearch remounts. Better Auth rejects a second anonymous sign-in.
  const hasGuestSession =
    args.isAnonymousUser || isGuestSession(authSession?.user);

  // A mid-session upgrade lifts the quota block immediately.
  useEffect(() => {
    if (args.planTier !== null && args.planTier !== "free") {
      setQuotaExceeded(false);
    }
  }, [args.planTier]);

  const recordSearch = useCallback(() => {
    const record = () =>
      recordSearchMutation.mutate(undefined, {
        onSuccess: (result) => {
          setQuotaExceeded(!result.allowed);
          writeQuotaDedupe({
            query: lastQuotaQuery.current ?? "",
            exceeded: !result.allowed,
            day: currentUtcDay(),
          });
        },
      });

    if (args.isLoggedIn || hasGuestSession) {
      record();
      return;
    }

    void (async () => {
      try {
        await signIn.anonymous();
        record();
      } catch {
        // Guest session creation failed; fail open rather than block search
      }
    })();
  }, [args.isLoggedIn, hasGuestSession, recordSearchMutation]);

  useEffect(() => {
    // Restore the dedupe record after remounts: refreshing /search?q=...
    // neither re-counts the URL-restored query nor clears an active quota
    // block from before the refresh.
    if (lastQuotaQuery.current === null) {
      const stored = readQuotaDedupe(currentUtcDay());
      lastQuotaQuery.current = stored?.query ?? "";
      if (stored?.exceeded) {
        setQuotaExceeded(true);
      }
    }
    if (!args.analyticsSearchValue || args.isSearching || args.hasError) return;
    if (lastQuotaQuery.current === args.analyticsSearchValue) return;
    lastQuotaQuery.current = args.analyticsSearchValue;
    recordSearch();
  }, [
    args.analyticsSearchValue,
    args.isSearching,
    args.hasError,
    recordSearch,
  ]);

  return quotaExceeded;
}

interface AdvancedFilterGateArgs {
  canUseAdvancedFilters: boolean;
  isLoggedIn: boolean;
  isTierResolved: boolean;
  indexUiState: InstantSearchUiState;
  setIndexUiState: (
    updater: (prev: InstantSearchUiState) => InstantSearchUiState,
  ) => void;
}

/**
 * Strips URL-carried advanced filters for free-tier users before they reach
 * Algolia. Waits for the plan tier to resolve so paying users don't lose
 * filters mid-load.
 */
export function useAdvancedFilterGate(args: AdvancedFilterGateArgs): void {
  const {
    canUseAdvancedFilters,
    isLoggedIn,
    isTierResolved,
    indexUiState,
    setIndexUiState,
  } = args;

  useEffect(() => {
    if (canUseAdvancedFilters) return;
    if (isLoggedIn && !isTierResolved) return;
    const hasAdvancedRefinements =
      Object.keys(indexUiState.refinementList ?? {}).length > 0 ||
      Object.keys(indexUiState.range ?? {}).length > 0;
    if (!hasAdvancedRefinements) return;
    setIndexUiState((prev) => ({
      ...prev,
      refinementList: {},
      range: {},
    }));
    posthog.capture(AnalyticsEvents.FILTERS_CLEARED, {
      reason: "plan_restricted",
    });
    toast.info("Filters are available on Lite and Full plans.");
  }, [
    canUseAdvancedFilters,
    isLoggedIn,
    isTierResolved,
    indexUiState,
    setIndexUiState,
  ]);
}

export function FreeQuotaOverlay({
  query,
  isGuest,
}: {
  query: string;
  /** Guests hit this block too; analytics should distinguish them. */
  isGuest: boolean;
}) {
  return (
    <div className="bg-card mx-auto w-full max-w-2xl rounded-lg border p-6 text-left shadow-lg">
      <p className="text-sm font-medium">Daily limit reached</p>
      <h3 className="mt-2 text-xl font-semibold tracking-tight text-balance">
        You&apos;ve used all {FREE_DAILY_SEARCH_LIMIT} free searches for today.
      </h3>
      <p className="text-muted-foreground mt-2 max-w-2xl text-sm text-pretty">
        Upgrade to Lite (${PLANS.lite.monthlyPrice}/mo) for unlimited searches,
        advanced filters, and saved searches. Your searches reset tomorrow.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link
            href="/pricing"
            onClick={() =>
              posthog.capture(AnalyticsEvents.PRICING_CTA_CLICKED, {
                source_page: "search",
                cta_location: "free_quota_limit",
                query,
                is_logged_in: !isGuest,
              })
            }
          >
            See Pricing
          </Link>
        </Button>
      </div>
    </div>
  );
}
