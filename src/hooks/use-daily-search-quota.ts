"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signIn, useSession } from "~/lib/auth-client";
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

interface QuotaDedupeRecord {
  userId: string;
  query: string;
  exceeded: boolean;
  day: string;
}

const QUOTA_DEDUPE_KEY = "ji:quotaDedupe";

function readQuotaDedupe(
  today: string,
  userId: string,
): QuotaDedupeRecord | null {
  try {
    const raw = window.sessionStorage.getItem(QUOTA_DEDUPE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("query" in parsed) ||
      !("exceeded" in parsed) ||
      !("day" in parsed) ||
      !("userId" in parsed) ||
      typeof parsed.query !== "string" ||
      typeof parsed.exceeded !== "boolean" ||
      typeof parsed.day !== "string" ||
      typeof parsed.userId !== "string" ||
      parsed.day !== today ||
      parsed.userId !== userId
    ) {
      return null;
    }
    return {
      userId: parsed.userId,
      query: parsed.query,
      exceeded: parsed.exceeded,
      day: parsed.day,
    };
  } catch {
    return null;
  }
}

function writeQuotaDedupe(record: QuotaDedupeRecord): void {
  try {
    window.sessionStorage.setItem(QUOTA_DEDUPE_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable; in-memory dedupe still applies for this mount.
  }
}

export function useDailySearchQuota(args: DailySearchQuotaArgs): boolean {
  const recordSearchMutation = api.usage.recordSearch.useMutation();
  const lastQuotaQuery = useRef<string | null>(null);
  const restoredUserId = useRef<string | null>(null);
  const isCreatingGuest = useRef(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const { data: authSession } = useSession();
  const viewer = resolveQuotaViewer(args.initialViewer, authSession?.user);
  const quotaUserId = viewer.kind === "signed_out" ? null : viewer.userId;

  useEffect(() => {
    if (args.planTier !== null && args.planTier !== "free") {
      setQuotaExceeded(false);
    }
  }, [args.planTier]);

  const recordSearch = useCallback(() => {
    if (viewer.kind === "signed_out") {
      if (isCreatingGuest.current) return;
      isCreatingGuest.current = true;
      void signIn
        .anonymous()
        .catch(() => undefined)
        .finally(() => {
          isCreatingGuest.current = false;
        });
      return;
    }

    recordSearchMutation.mutate(undefined, {
      onSuccess: (result) => {
        setQuotaExceeded(!result.allowed);
        writeQuotaDedupe({
          userId: viewer.userId,
          query: lastQuotaQuery.current ?? "",
          exceeded: !result.allowed,
          day: currentUtcDay(),
        });
      },
    });
  }, [viewer, recordSearchMutation]);

  useEffect(() => {
    if (quotaUserId === null) {
      if (args.analyticsSearchValue && !args.isSearching && !args.hasError) {
        recordSearch();
      }
      return;
    }

    if (restoredUserId.current !== quotaUserId) {
      const isIdentityChange = restoredUserId.current !== null;
      restoredUserId.current = quotaUserId;
      const stored = readQuotaDedupe(currentUtcDay(), quotaUserId);
      lastQuotaQuery.current =
        stored?.query ?? (isIdentityChange ? args.analyticsSearchValue : "");
      setQuotaExceeded(stored?.exceeded ?? false);
    }

    if (!args.analyticsSearchValue || args.isSearching || args.hasError) return;
    if (lastQuotaQuery.current === args.analyticsSearchValue) return;
    lastQuotaQuery.current = args.analyticsSearchValue;
    recordSearch();
  }, [
    args.analyticsSearchValue,
    args.isSearching,
    args.hasError,
    quotaUserId,
    recordSearch,
  ]);

  return quotaExceeded;
}
