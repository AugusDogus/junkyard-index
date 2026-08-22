interface SessionUserLike {
  isAnonymous?: boolean | null;
}

/** True for Better Auth anonymous (guest) sessions created on /search. */
export function isGuestSession(
  user: SessionUserLike | null | undefined,
): boolean {
  return user?.isAnonymous === true;
}

/**
 * True when the session belongs to a real (non-guest) account. Guest sessions
 * are invisible in the UI; guests still count toward the free daily search
 * limit. Type predicate narrows away null/undefined only.
 */
export function isVisibleSessionUser<T extends SessionUserLike>(
  user: T | null | undefined,
): user is T {
  return !!user && !isGuestSession(user);
}
