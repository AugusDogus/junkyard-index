import { Cause, Data, Runtime } from "effect";

/** Where an Algolia call failed and what Algolia (or the transport) said. */
interface AlgoliaFailure {
  /** The client call that failed, such as `saveObjects`. */
  operation: string;
  indexName: string | null;
  /** The HTTP status Algolia answered with; null when no response came. */
  status: number | null;
  /** Algolia's own message, or the transport error's. */
  detail: string;
  message: string;
  cause: unknown;
}

type AlgoliaFailureFields = Omit<AlgoliaFailure, "message">;

/** The app is blocked (for example, over its plan quota): every call fails until it is unblocked. */
export class SearchBackendBlocked extends Data.TaggedError(
  "SearchBackendBlocked",
)<AlgoliaFailure> {}

/** A plan quota (records or operations) is used up. */
export class QuotaExceeded extends Data.TaggedError(
  "QuotaExceeded",
)<AlgoliaFailure> {}

/** Algolia throttled the call (HTTP 429). */
export class RateLimited extends Data.TaggedError(
  "RateLimited",
)<AlgoliaFailure> {}

/** The index or object does not exist (HTTP 404). */
export class NotFound extends Data.TaggedError("NotFound")<AlgoliaFailure> {}

/** Algolia rejected the request itself; retrying it unchanged fails again. */
export class InvalidRequest extends Data.TaggedError(
  "InvalidRequest",
)<AlgoliaFailure> {}

/** No response, a server error, or a cause this classifier does not know. */
export class Transient extends Data.TaggedError("Transient")<AlgoliaFailure> {}

export type AlgoliaError =
  | SearchBackendBlocked
  | QuotaExceeded
  | RateLimited
  | NotFound
  | InvalidRequest
  | Transient;

type AlgoliaErrorTag = AlgoliaError["_tag"];

/** Most specific first: an aggregate reports its most telling failure. */
const SPECIFICITY: readonly AlgoliaErrorTag[] = [
  "SearchBackendBlocked",
  "QuotaExceeded",
  "RateLimited",
  "NotFound",
  "InvalidRequest",
  "Transient",
];

function isAlgoliaError(value: unknown): value is AlgoliaError {
  return (
    value instanceof SearchBackendBlocked ||
    value instanceof QuotaExceeded ||
    value instanceof RateLimited ||
    value instanceof NotFound ||
    value instanceof InvalidRequest ||
    value instanceof Transient
  );
}

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

/**
 * Every error inside a failure: `cause` chains, `AggregateError.errors`, and
 * the failures and defects of an Effect fiber failure, outermost first.
 */
function nestedErrors(error: unknown): unknown[] {
  const found: unknown[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (value === undefined || value === null || seen.has(value)) return;
    seen.add(value);
    found.push(value);
    if (Runtime.isFiberFailure(value)) {
      const cause = value[Runtime.FiberFailureCauseId];
      for (const failure of Cause.failures(cause)) visit(failure);
      for (const defect of Cause.defects(cause)) visit(defect);
    }
    if (value instanceof AggregateError) {
      for (const nested of value.errors) visit(nested);
    }
    if (typeof value === "object" && "cause" in value) visit(value.cause);
  };
  visit(error);
  return found;
}

function tagOf(status: number | null, detail: string): AlgoliaErrorTag {
  if ((status === 403 || status === 429) && /quota/i.test(detail))
    return "QuotaExceeded";
  if (status === 403 && /\bblocked\b/i.test(detail))
    return "SearchBackendBlocked";
  if (status === 429) return "RateLimited";
  if (status === 404) return "NotFound";
  if (status !== null && status >= 400 && status < 500) return "InvalidRequest";
  return "Transient";
}

const CONSEQUENCE: Record<AlgoliaErrorTag, string> = {
  SearchBackendBlocked:
    "The Algolia application is blocked, so search reads and writes fail until it is unblocked (plan quota reset or upgrade). Turso inventory is unaffected; retry the publication after the block lifts.",
  QuotaExceeded:
    "An Algolia plan quota is used up. Turso inventory is unaffected; free records or wait for the quota period to reset, then retry.",
  RateLimited:
    "Algolia throttled the request. Retry with backoff; nothing was lost.",
  NotFound:
    "The Algolia index or object does not exist. Check the index name, or treat the target as already removed.",
  InvalidRequest:
    "Algolia rejected the request. Retrying it unchanged fails again; check the API key's rights and the request payload.",
  Transient:
    "No usable Algolia answer (network, server error, or an unrecognized failure). Retrying is safe.",
};

function build(tag: AlgoliaErrorTag, fields: AlgoliaFailureFields) {
  const where = fields.indexName
    ? `${fields.operation} on index ${fields.indexName}`
    : fields.operation;
  const status =
    fields.status === null ? "no response" : `HTTP ${fields.status}`;
  const failure: AlgoliaFailure = {
    ...fields,
    message: `Algolia ${where} failed (${tag}, ${status}): ${fields.detail}. ${CONSEQUENCE[tag]}`,
  };
  switch (tag) {
    case "SearchBackendBlocked":
      return new SearchBackendBlocked(failure);
    case "QuotaExceeded":
      return new QuotaExceeded(failure);
    case "RateLimited":
      return new RateLimited(failure);
    case "NotFound":
      return new NotFound(failure);
    case "InvalidRequest":
      return new InvalidRequest(failure);
    case "Transient":
      return new Transient(failure);
  }
}

export const AlgoliaError = {
  /**
   * Classifies a failed Algolia call by the most specific Algolia answer
   * inside it, unwrapping `cause`, `AggregateError.errors` and Effect fiber
   * failures. An already classified error is returned as is.
   */
  classify(
    context: { operation: string; indexName?: string },
    error: unknown,
  ): AlgoliaError {
    const rank = (tag: AlgoliaErrorTag) => SPECIFICITY.indexOf(tag);
    const nested = nestedErrors(error);
    const [classified] = nested
      .filter(isAlgoliaError)
      .sort((a, b) => rank(a._tag) - rank(b._tag));
    // Only an HTTP answer says more than "transient".
    const [answer] = nested
      .filter((value) => !isAlgoliaError(value))
      .flatMap((value) => {
        const status = statusOf(value);
        if (status === null) return [];
        const detail = messageOf(value);
        return [{ status, detail, tag: tagOf(status, detail) }];
      })
      .sort((a, b) => rank(a.tag) - rank(b.tag));
    if (
      classified !== undefined &&
      (answer === undefined || rank(classified._tag) <= rank(answer.tag))
    )
      return classified;
    return build(answer?.tag ?? "Transient", {
      operation: context.operation,
      indexName: context.indexName ?? null,
      status: answer?.status ?? null,
      detail: answer?.detail ?? messageOf(error),
      cause: error,
    });
  },

  is: isAlgoliaError,
} as const;
