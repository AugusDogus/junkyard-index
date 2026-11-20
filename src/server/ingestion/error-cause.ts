import { Cause, Chunk, Runtime } from "effect";

/** Finds the first failure matching `match` through Error causes, Effect
 * fiber failures, AggregateErrors and the wrappers connectors add, so a
 * workflow step can recognise a typed condition behind any wrapping. */
export function findCause<T>(
  error: unknown,
  match: (cause: unknown) => cause is T,
): T | null {
  const pending = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object" || seen.has(current))
      continue;
    seen.add(current);
    if (match(current)) return current;
    if (Runtime.isFiberFailure(current)) {
      const cause = current[Runtime.FiberFailureCauseId];
      pending.push(
        ...Chunk.toReadonlyArray(Cause.failures(cause)),
        ...Chunk.toReadonlyArray(Cause.defects(cause)),
      );
    }
    if (current instanceof AggregateError) pending.push(...current.errors);
    if ("cause" in current) pending.push(current.cause);
    // Effect's UnknownException keeps the rejected value in `error`.
    if (Cause.isUnknownException(current)) pending.push(current.error);
  }
  return null;
}
