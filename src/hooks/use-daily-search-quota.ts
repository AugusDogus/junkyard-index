"use client";

import { useEffect, useReducer, useRef } from "react";
import { useSession } from "~/lib/auth-client";
import {
  initialQuotaLifecycleState,
  parseStoredAccountQuotaRecord,
  parseStoredBrowserQuotaRecord,
  quotaStatusForQuery,
  recordBrowserSearch,
  transitionQuotaLifecycle,
  type QuotaLifecycleStatus,
  type StoredAccountQuotaRecord,
  type StoredBrowserQuotaRecord,
} from "~/lib/quota-lifecycle";
import type { PlanTier } from "~/lib/plans";
import { currentUtcDay } from "~/lib/search-quota";
import { resolveQuotaViewer, type QuotaViewer } from "~/lib/quota-viewer";
import { api } from "~/trpc/react";

interface DailySearchQuotaArgs {
  initialViewer: QuotaViewer;
  planTier: PlanTier | null;
  analyticsSearchValue: string;
  isSearching: boolean;
  hasError: boolean;
}

const ACCOUNT_QUOTA_DEDUPE_KEY_PREFIX = "ji:accountQuotaDedupe:";
const BROWSER_QUOTA_KEY = "ji:browserSearchQuota";

export type DailySearchQuotaStatus = QuotaLifecycleStatus;

export type SearchQuotaGateState =
  | { kind: "open" }
  | { kind: "verifying" }
  | { kind: "limit_exceeded" }
  | { kind: "verification_unavailable" };

function readStoredAccountRecord(
  userId: string,
): StoredAccountQuotaRecord | null {
  try {
    return parseStoredAccountQuotaRecord({
      raw: window.sessionStorage.getItem(
        `${ACCOUNT_QUOTA_DEDUPE_KEY_PREFIX}${userId}`,
      ),
      today: currentUtcDay(),
      userId,
    });
  } catch {
    return null;
  }
}

function writeStoredAccountRecord(record: StoredAccountQuotaRecord): void {
  try {
    window.sessionStorage.setItem(
      `${ACCOUNT_QUOTA_DEDUPE_KEY_PREFIX}${record.userId}`,
      JSON.stringify(record),
    );
  } catch {
    // Reducer state still deduplicates this mount when storage is unavailable.
  }
}

function readStoredBrowserRecord(): StoredBrowserQuotaRecord | null {
  try {
    return parseStoredBrowserQuotaRecord({
      raw: window.localStorage.getItem(BROWSER_QUOTA_KEY),
      today: currentUtcDay(),
    });
  } catch {
    return null;
  }
}

function writeStoredBrowserRecord(record: StoredBrowserQuotaRecord): void {
  try {
    window.localStorage.setItem(BROWSER_QUOTA_KEY, JSON.stringify(record));
  } catch {
    // The in-memory record still enforces the quota for this mount.
  }
}

export function useDailySearchQuota(
  args: DailySearchQuotaArgs,
): DailySearchQuotaStatus {
  const [state, dispatch] = useReducer(
    transitionQuotaLifecycle,
    initialQuotaLifecycleState,
  );
  const browserRecord = useRef<StoredBrowserQuotaRecord | null>(null);
  const accountRequestActive = useRef<string | null>(null);
  const quotaApplies = args.planTier === null || args.planTier === "free";
  const quotaAppliesRef = useRef(quotaApplies);
  quotaAppliesRef.current = quotaApplies;
  const recordSearchMutation = api.usage.recordSearch.useMutation();
  const {
    data: authSession,
    isPending: isSessionPending,
    error: sessionError,
  } = useSession();
  const viewer = resolveQuotaViewer(
    args.initialViewer,
    isSessionPending
      ? { kind: "loading" }
      : sessionError
        ? { kind: "failed" }
        : { kind: "resolved", user: authSession?.user ?? null },
  );
  const viewerUserId = viewer.kind === "signed_out" ? null : viewer.userId;

  useEffect(() => {
    dispatch({
      type: "viewer_resolved",
      userId: viewerUserId,
      stored: viewerUserId ? readStoredAccountRecord(viewerUserId) : null,
    });
  }, [viewerUserId]);

  useEffect(() => {
    dispatch({
      type: quotaApplies ? "free_tier_resolved" : "paid_tier_resolved",
    });
  }, [quotaApplies]);

  useEffect(() => {
    if (args.planTier !== null && args.planTier !== "free") return;
    if (args.isSearching || args.hasError) return;
    dispatch({ type: "search_ready", query: args.analyticsSearchValue });
  }, [
    args.analyticsSearchValue,
    args.isSearching,
    args.hasError,
    args.planTier,
    state.userId,
    state.phase.kind,
  ]);

  useEffect(() => {
    if (state.phase.kind !== "recording_browser") return;
    const { query } = state.phase;
    const today = currentUtcDay();
    const prior =
      (browserRecord.current?.day === today ? browserRecord.current : null) ??
      readStoredBrowserRecord();
    const next = recordBrowserSearch({ prior, query, today });
    browserRecord.current = next;
    writeStoredBrowserRecord(next);
    dispatch({
      type: "browser_record_succeeded",
      query,
      allowed: !next.exceeded,
    });
  }, [state.phase]);

  useEffect(() => {
    if (state.phase.kind !== "recording_account") return;
    const { userId, query } = state.phase;
    const requestKey = JSON.stringify([userId, query]);
    if (accountRequestActive.current === requestKey) return;
    accountRequestActive.current = requestKey;
    recordSearchMutation.mutate(undefined, {
      onSuccess: ({ allowed }) => {
        if (!quotaAppliesRef.current) return;
        dispatch({
          type: "account_record_succeeded",
          userId,
          query,
          allowed,
        });
        writeStoredAccountRecord({
          userId,
          query,
          exceeded: !allowed,
          day: currentUtcDay(),
        });
      },
      onError: () => {
        if (quotaAppliesRef.current) {
          dispatch({ type: "account_record_failed", userId, query });
        }
      },
      onSettled: () => {
        if (accountRequestActive.current === requestKey) {
          accountRequestActive.current = null;
        }
      },
    });
  }, [state.phase, recordSearchMutation]);

  return quotaStatusForQuery(state, args.analyticsSearchValue);
}

export function useSearchQuotaGate(
  args: DailySearchQuotaArgs & { hasActiveSearch: boolean },
): SearchQuotaGateState {
  const status = useDailySearchQuota(args);
  if (!args.hasActiveSearch || args.hasError || status === "allowed") {
    return { kind: "open" };
  }
  return { kind: status };
}
