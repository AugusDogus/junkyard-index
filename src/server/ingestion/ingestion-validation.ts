import { Cause, Effect, Runtime } from "effect";

/**
 * Why a provider rejected its crawl.
 *
 * - deterministic: the provider's data fails a parsing, closing-control or
 *   quality guard. A recrawl the same day sees the same data, so the source
 *   is done for the day.
 * - transient: the crawl could not prove completeness for a reason that
 *   passes, such as a host that kept rate-limiting or a catalog that changed
 *   while it was read. The source retries after its usual delay within its
 *   daily attempts.
 */
export type ValidationRejectionKind = "deterministic" | "transient";

// Keep the provider's existing error type and identity. The durable fetch
// boundary consumes this marker before Workflow serialization can discard it.
const rejections = new WeakMap<object, ValidationRejectionKind>();

/** Marks `error` as a provider rejection. A transient mark is never
 * downgraded, so a provider wrapper cannot hide a transient cause. */
export function validationRejection<E>(
  error: E,
  kind: ValidationRejectionKind = "deterministic",
): E {
  if (
    typeof error === "object" &&
    error !== null &&
    rejections.get(error) !== "transient"
  )
    rejections.set(error, kind);
  return error;
}

/** Marks `error` as a rejection that a later crawl the same day can clear. */
export function transientRejection<E>(error: E): E {
  return validationRejection(error, "transient");
}

/** Synchronous provider parsing, closing controls and quality guards cannot be
 * repaired by retrying the same frozen crawl. HTTP/body effects stay transient. */
export function ingestionValidation<A, E>(options: {
  try: () => A;
  catch: (cause: unknown) => E;
}): Effect.Effect<A, E> {
  return Effect.try(options).pipe(
    Effect.mapError((error) => validationRejection(error)),
  );
}

/**
 * The rejection kind marked anywhere in `error`'s causes, or null when it is
 * not a rejection (an ordinary failure the step retries). A transient mark
 * anywhere wins over a deterministic wrapper.
 */
export function validationRejectionKind(
  error: unknown,
): ValidationRejectionKind | null {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  let found: ValidationRejectionKind | null = null;
  while (pending.length) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    if (typeof current !== "object" || current === null) continue;
    const kind = rejections.get(current);
    if (kind === "transient") return kind;
    if (kind) found = kind;
    if (Runtime.isFiberFailure(current))
      pending.push(...Cause.failures(current[Runtime.FiberFailureCauseId]));
    if ("cause" in current) pending.push(current.cause);
  }
  return found;
}

export function isValidationRejection(error: unknown): boolean {
  return validationRejectionKind(error) !== null;
}
