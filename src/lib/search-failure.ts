import { AlgoliaFailureTag } from "~/lib/algolia-failure-tag";

/**
 * What a failed search means for the person searching. `backend_blocked`
 * covers a blocked Algolia app and an exhausted plan quota: search is down
 * for everyone until it lifts, but pages that read Turso still work.
 */
export type SearchFailure =
  | { kind: "backend_blocked" }
  | { kind: "unexpected" };

const BLOCKING_TAGS = new Set(["SearchBackendBlocked", "QuotaExceeded"]);

/** The error and everything nested in its `cause` chain or aggregate. */
function nested(error: unknown): unknown[] {
  const found: unknown[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (value === undefined || value === null || seen.has(value)) return;
    seen.add(value);
    found.push(value);
    if (value instanceof AggregateError) {
      for (const inner of value.errors) visit(inner);
    }
    if (typeof value === "object" && "cause" in value) visit(value.cause);
  };
  visit(error);
  return found;
}

/**
 * Classifies a browser search failure: an algoliasearch `ApiError` (HTTP
 * status plus Algolia's message), or an error the server already tagged.
 */
function classify(error: unknown): SearchFailure {
  const blocked = nested(error).some((value) => {
    if (
      typeof value === "object" &&
      value !== null &&
      "_tag" in value &&
      typeof value._tag === "string" &&
      BLOCKING_TAGS.has(value._tag)
    )
      return true;
    const status = AlgoliaFailureTag.statusOf(value);
    return (
      status !== null &&
      BLOCKING_TAGS.has(
        AlgoliaFailureTag.fromAnswer(
          status,
          AlgoliaFailureTag.messageOf(value),
        ),
      )
    );
  });
  return blocked ? { kind: "backend_blocked" } : { kind: "unexpected" };
}

export const SearchFailure = { classify } as const;
