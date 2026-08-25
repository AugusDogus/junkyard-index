export interface StoredQuotaRecord {
  userId: string;
  query: string;
  exceeded: boolean;
  day: string;
}

type QuotaActivity =
  | { kind: "idle" }
  | { kind: "creating_guest"; query: string }
  | { kind: "guest_creation_failed"; query: string }
  | { kind: "recording"; userId: string; query: string };

export interface QuotaLifecycleState {
  userId: string | null;
  lastQuery: string;
  status: "allowed" | "limit_exceeded" | "verification_unavailable";
  activity: QuotaActivity;
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
  | { type: "paid_tier_resolved" };

export const initialQuotaLifecycleState: QuotaLifecycleState = {
  userId: null,
  lastQuery: "",
  status: "allowed",
  activity: { kind: "idle" },
};

export function transitionQuotaLifecycle(
  state: QuotaLifecycleState,
  event: QuotaLifecycleEvent,
): QuotaLifecycleState {
  switch (event.type) {
    case "viewer_resolved": {
      if (event.userId === null) return { ...state, userId: null };
      if (event.userId === state.userId) return state;
      const isIdentityChange = state.userId !== null;
      return {
        userId: event.userId,
        lastQuery:
          event.stored?.query ?? (isIdentityChange ? event.currentQuery : ""),
        status: event.stored?.exceeded ? "limit_exceeded" : "allowed",
        activity: { kind: "idle" },
      };
    }
    case "search_ready":
      if (
        state.activity.kind === "creating_guest" ||
        state.activity.kind === "recording" ||
        event.query.length === 0 ||
        event.query === state.lastQuery ||
        (state.activity.kind === "guest_creation_failed" &&
          event.query === state.activity.query)
      ) {
        return state;
      }
      if (state.userId === null) {
        return {
          ...state,
          status: "allowed",
          activity: { kind: "creating_guest", query: event.query },
        };
      }
      return {
        ...state,
        lastQuery: event.query,
        status: "allowed",
        activity: {
          kind: "recording",
          userId: state.userId,
          query: event.query,
        },
      };
    case "guest_creation_failed":
      return state.activity.kind === "creating_guest"
        ? {
            ...state,
            status: "verification_unavailable",
            activity: {
              kind: "guest_creation_failed",
              query: state.activity.query,
            },
          }
        : state;
    case "record_failed":
      return state.activity.kind === "recording" &&
        state.activity.userId === event.userId &&
        state.activity.query === event.query
        ? {
            ...state,
            status: "verification_unavailable",
            activity: { kind: "idle" },
          }
        : state;
    case "record_succeeded":
      return state.activity.kind === "recording" &&
        state.activity.userId === event.userId &&
        state.activity.query === event.query
        ? {
            ...state,
            status: event.allowed ? "allowed" : "limit_exceeded",
            activity: { kind: "idle" },
          }
        : state;
    case "paid_tier_resolved":
      return state.status === "allowed"
        ? state
        : { ...state, status: "allowed" };
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
