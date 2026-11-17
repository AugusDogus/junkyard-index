import { Cause, Effect, Runtime } from "effect";

// Keep the provider's existing error type and identity. The durable fetch
// boundary consumes this marker before Workflow serialization can discard it.
const rejections = new WeakSet<object>();
export function validationRejection<E>(error: E): E {
  if (typeof error === "object" && error !== null) rejections.add(error);
  return error;
}

/** Synchronous provider parsing, closing controls and quality guards cannot be
 * repaired by retrying the same frozen crawl. HTTP/body effects stay transient. */
export function ingestionValidation<A, E>(options: {
  try: () => A;
  catch: (cause: unknown) => E;
}): Effect.Effect<A, E> {
  return Effect.try(options).pipe(Effect.mapError(validationRejection));
}

export function isValidationRejection(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  while (pending.length) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    if (typeof current !== "object" || current === null) continue;
    if (rejections.has(current)) return true;
    if (Runtime.isFiberFailure(current))
      pending.push(...Cause.failures(current[Runtime.FiberFailureCauseId]));
    if ("cause" in current) pending.push(current.cause);
  }
  return false;
}
