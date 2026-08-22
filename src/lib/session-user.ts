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
 * limit.
 */
export function isVisibleSessionUser(
  user: SessionUserLike | null | undefined,
): boolean {
  return !!user && !isGuestSession(user);
}
