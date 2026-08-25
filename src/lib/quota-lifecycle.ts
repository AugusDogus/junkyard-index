export interface StoredQuotaRecord {
  userId: string;
  query: string;
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
  | { kind: "creating_guest"; query: string }
  | { kind: "guest_creation_failed"; query: string }
  | { kind: "recording"; userId: string; query: string }
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
      stored: StoredQuotaRecord | null;
    }
  | { type: "search_ready"; query: string }
  | { type: "guest_creation_failed" }
  | { type: "record_failed"; userId: string; query: string }
  | {
      type: "record_succeeded";
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
        state.phase.kind === "creating_guest" ||
        state.phase.kind === "recording" ||
        event.query.length === 0 ||
        event.query === state.lastQuery ||
        (state.phase.kind === "guest_creation_failed" &&
          event.query === state.phase.query)
      ) {
        return state;
      }
      if (state.userId === null) {
        return {
          ...state,
          phase: { kind: "creating_guest", query: event.query },
        };
      }
      return {
        ...state,
        lastQuery: event.query,
        phase: {
          kind: "recording",
          userId: state.userId,
          query: event.query,
        },
      };
    case "guest_creation_failed":
      return state.phase.kind === "creating_guest"
        ? {
            ...state,
            phase: {
              kind: "guest_creation_failed",
              query: state.phase.query,
            },
          }
        : state;
    case "record_failed":
      return state.phase.kind === "recording" &&
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
    case "record_succeeded":
      return state.phase.kind === "recording" &&
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
    case "creating_guest":
    case "recording":
      return "verifying";
    case "guest_creation_failed":
    case "record_failed":
      return "verification_unavailable";
    case "idle":
      if (state.phase.access === "limit_exceeded") return "limit_exceeded";
      return query.length > 0 && state.lastQuery !== query
        ? "verifying"
        : "allowed";
  }
}

export function parseStoredQuotaRecord(input: {
  raw: string | null;
  today: string;
  userId: string;
}): StoredQuotaRecord | null {
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
