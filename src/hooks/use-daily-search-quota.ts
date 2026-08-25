"use client";

import { useEffect, useReducer, useRef } from "react";
import { signIn, useSession } from "~/lib/auth-client";
import {
  initialQuotaLifecycleState,
  parseStoredQuotaRecord,
  transitionQuotaLifecycle,
  type StoredQuotaRecord,
} from "~/lib/quota-lifecycle";
import { currentUtcDay, type PlanTier } from "~/lib/plans";
import { resolveQuotaViewer, type QuotaViewer } from "~/lib/quota-viewer";
import { api } from "~/trpc/react";

interface DailySearchQuotaArgs {
  initialViewer: QuotaViewer;
  planTier: PlanTier | null;
  analyticsSearchValue: string;
  isSearching: boolean;
  hasError: boolean;
}

const QUOTA_DEDUPE_KEY = "ji:quotaDedupe";

function readStoredRecord(userId: string): StoredQuotaRecord | null {
  try {
    return parseStoredQuotaRecord({
      raw: window.sessionStorage.getItem(QUOTA_DEDUPE_KEY),
      today: currentUtcDay(),
      userId,
    });
  } catch {
    return null;
  }
}

function writeStoredRecord(record: StoredQuotaRecord): void {
  try {
    window.sessionStorage.setItem(QUOTA_DEDUPE_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable; reducer state still deduplicates this mount.
  }
}

export function useDailySearchQuota(args: DailySearchQuotaArgs): boolean {
  const [state, dispatch] = useReducer(
    transitionQuotaLifecycle,
    initialQuotaLifecycleState,
  );
  const guestRequestActive = useRef(false);
  const recordRequestActive = useRef<string | null>(null);
  const recordSearchMutation = api.usage.recordSearch.useMutation();
  const { data: authSession } = useSession();
  const viewer = resolveQuotaViewer(args.initialViewer, authSession?.user);
  const viewerUserId = viewer.kind === "signed_out" ? null : viewer.userId;

  useEffect(() => {
    dispatch({
      type: "viewer_resolved",
      userId: viewerUserId,
      currentQuery: args.analyticsSearchValue,
      stored: viewerUserId ? readStoredRecord(viewerUserId) : null,
    });
  }, [viewerUserId, args.analyticsSearchValue]);

  useEffect(() => {
    if (args.planTier !== null && args.planTier !== "free") {
      dispatch({ type: "paid_tier_resolved" });
    }
  }, [args.planTier]);

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
    state.activity.kind,
  ]);

  useEffect(() => {
    if (state.activity.kind !== "creating_guest") return;
    if (guestRequestActive.current) return;
    guestRequestActive.current = true;
    void signIn
      .anonymous()
      .catch(() => dispatch({ type: "guest_creation_failed" }))
      .finally(() => {
        guestRequestActive.current = false;
      });
  }, [state.activity]);

  useEffect(() => {
    if (state.activity.kind !== "recording") return;
    const { userId, query } = state.activity;
    const requestKey = JSON.stringify([userId, query]);
    if (recordRequestActive.current === requestKey) return;
    recordRequestActive.current = requestKey;
    recordSearchMutation.mutate(undefined, {
      onSuccess: ({ allowed }) => {
        dispatch({ type: "record_succeeded", userId, query, allowed });
        writeStoredRecord({
          userId,
          query,
          exceeded: !allowed,
          day: currentUtcDay(),
        });
      },
      onError: () => dispatch({ type: "record_failed", userId, query }),
      onSettled: () => {
        if (recordRequestActive.current === requestKey) {
          recordRequestActive.current = null;
        }
      },
    });
  }, [state.activity, recordSearchMutation]);

  return state.quotaExceeded;
}
