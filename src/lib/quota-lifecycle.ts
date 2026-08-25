import { evaluateSearchQuota } from "~/lib/search-quota";

export interface StoredAccountQuotaRecord {
  userId: string;
  query: string;
  exceeded: boolean;
  day: string;
}

export interface StoredBrowserQuotaRecord {
  query: string;
  count: number;
  exceeded: boolean;
  day: string;
}

export type QuotaLifecycleStatus =
  | "allowed"
  | "verifying"
  | "limit_exceeded"
  | "verification_unavailable";

type QuotaLifecyclePhase =
  | { kind: "exempt" }
  | { kind: "idle"; access: "allowed" | "limit_exceeded" }
  | { kind: "recording_browser"; query: string }
  | { kind: "recording_account"; userId: string; query: string }
  | { kind: "record_failed"; userId: string; query: string };

export interface QuotaLifecycleState {
  userId: string | null;
  lastQuery: string;
  phase: QuotaLifecyclePhase;
}

export type QuotaLifecycleEvent =
  | {
      type: "viewer_resolved";
      userId: string | null;
      currentQuery: string;
      stored: StoredAccountQuotaRecord | null;
    }
  | { type: "search_ready"; query: string }
  | { type: "browser_record_succeeded"; query: string; allowed: boolean }
  | { type: "account_record_failed"; userId: string; query: string }
  | {
      type: "account_record_succeeded";
      userId: string;
      query: string;
      allowed: boolean;
    }
  | { type: "paid_tier_resolved" }
  | { type: "free_tier_resolved" };

export const initialQuotaLifecycleState: QuotaLifecycleState = {
  userId: null,
  lastQuery: "",
  phase: { kind: "idle", access: "allowed" },
};

export function transitionQuotaLifecycle(
  state: QuotaLifecycleState,
  event: QuotaLifecycleEvent,
): QuotaLifecycleState {
  switch (event.type) {
    case "viewer_resolved": {
      if (event.userId === null) {
        return state.userId === null
          ? state
          : {
              userId: null,
              lastQuery: "",
              phase: { kind: "idle", access: "allowed" },
            };
      }
      if (event.userId === state.userId) return state;
      const isIdentityChange = state.userId !== null;
      return {
        userId: event.userId,
        lastQuery:
          event.stored?.query ?? (isIdentityChange ? event.currentQuery : ""),
        phase: {
          kind: "idle",
          access: event.stored?.exceeded
            ? "limit_exceeded"
            : isIdentityChange &&
                state.phase.kind === "idle" &&
                state.phase.access === "limit_exceeded"
              ? "limit_exceeded"
              : "allowed",
        },
      };
    }
    case "search_ready":
      if (
        state.phase.kind === "exempt" ||
        state.phase.kind === "recording_browser" ||
        state.phase.kind === "recording_account" ||
        event.query.length === 0 ||
        event.query === state.lastQuery
      ) {
        return state;
      }
      return state.userId === null
        ? {
            ...state,
            phase: { kind: "recording_browser", query: event.query },
          }
        : {
            ...state,
            lastQuery: event.query,
            phase: {
              kind: "recording_account",
              userId: state.userId,
              query: event.query,
            },
          };
    case "browser_record_succeeded":
      return state.phase.kind === "recording_browser" &&
        state.phase.query === event.query
        ? {
            ...state,
            lastQuery: event.query,
            phase: {
              kind: "idle",
              access: event.allowed ? "allowed" : "limit_exceeded",
            },
          }
        : state;
    case "account_record_failed":
      return state.phase.kind === "recording_account" &&
        state.phase.userId === event.userId &&
        state.phase.query === event.query
        ? {
            ...state,
            phase: {
              kind: "record_failed",
              userId: event.userId,
              query: event.query,
            },
          }
        : state;
    case "account_record_succeeded":
      return state.phase.kind === "recording_account" &&
        state.phase.userId === event.userId &&
        state.phase.query === event.query
        ? {
            ...state,
            phase: {
              kind: "idle",
              access: event.allowed ? "allowed" : "limit_exceeded",
            },
          }
        : state;
    case "paid_tier_resolved":
      return state.phase.kind === "exempt"
        ? state
        : { ...state, phase: { kind: "exempt" } };
    case "free_tier_resolved":
      return state.phase.kind === "exempt"
        ? {
            ...state,
            lastQuery: "",
            phase: { kind: "idle", access: "allowed" },
          }
        : state;
  }
}

export function quotaStatusForQuery(
  state: QuotaLifecycleState,
  query: string,
): QuotaLifecycleStatus {
  switch (state.phase.kind) {
    case "exempt":
      return "allowed";
    case "recording_browser":
    case "recording_account":
      return "verifying";
    case "record_failed":
      return "verification_unavailable";
    case "idle":
      if (state.phase.access === "limit_exceeded") return "limit_exceeded";
      return query.length > 0 && state.lastQuery !== query
        ? "verifying"
        : "allowed";
  }
}

export function parseStoredAccountQuotaRecord(input: {
  raw: string | null;
  today: string;
  userId: string;
}): StoredAccountQuotaRecord | null {
  if (input.raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(input.raw);
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
      parsed.day !== input.today ||
      parsed.userId !== input.userId
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

export function parseStoredBrowserQuotaRecord(input: {
  raw: string | null;
  today: string;
}): StoredBrowserQuotaRecord | null {
  if (input.raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(input.raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("query" in parsed) ||
      !("count" in parsed) ||
      !("exceeded" in parsed) ||
      !("day" in parsed) ||
      typeof parsed.query !== "string" ||
      typeof parsed.count !== "number" ||
      !Number.isInteger(parsed.count) ||
      parsed.count < 0 ||
      typeof parsed.exceeded !== "boolean" ||
      typeof parsed.day !== "string" ||
      parsed.day !== input.today
    ) {
      return null;
    }
    return {
      query: parsed.query,
      count: parsed.count,
      exceeded: parsed.exceeded,
      day: parsed.day,
    };
  } catch {
    return null;
  }
}

export function recordBrowserSearch(input: {
  prior: StoredBrowserQuotaRecord | null;
  query: string;
  today: string;
}): StoredBrowserQuotaRecord {
  const prior = input.prior?.day === input.today ? input.prior : null;
  const count =
    prior?.query === input.query ? prior.count : (prior?.count ?? 0) + 1;
  return {
    query: input.query,
    count,
    exceeded: !evaluateSearchQuota(count).allowed,
    day: input.today,
  };
}
