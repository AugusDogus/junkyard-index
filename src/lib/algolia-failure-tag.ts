/**
 * How an Algolia answer is classified, without Effect, so browser code can
 * share it with the server's tagged errors (`server/ingestion/algolia-error.ts`).
 */
export type AlgoliaErrorTag =
  | "SearchBackendBlocked"
  | "QuotaExceeded"
  | "RateLimited"
  | "NotFound"
  | "InvalidRequest"
  | "Transient";

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  )
    return value.message;
  return String(value);
}

function statusOf(value: unknown): number | null {
  if (typeof value !== "object" || value === null || !("status" in value))
    return null;
  return typeof value.status === "number" ? value.status : null;
}

function fromAnswer(status: number | null, detail: string): AlgoliaErrorTag {
  if ((status === 403 || status === 429) && /quota/i.test(detail))
    return "QuotaExceeded";
  if (status === 403 && /\bblocked\b/i.test(detail))
    return "SearchBackendBlocked";
  if (status === 429) return "RateLimited";
  if (status === 404) return "NotFound";
  if (status !== null && status >= 400 && status < 500) return "InvalidRequest";
  return "Transient";
}

export const AlgoliaFailureTag = { messageOf, statusOf, fromAnswer } as const;
