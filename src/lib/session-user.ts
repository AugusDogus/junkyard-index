export interface SessionUserLike {
  isAnonymous?: boolean | null;
}

export type GuestSessionUser<T extends SessionUserLike> = T & {
  isAnonymous: true;
};

export type RegisteredSessionUser<T extends SessionUserLike> = T & {
  isAnonymous?: false | null;
};

/** True for Better Auth anonymous (guest) sessions created on /search. */
export function isGuestSession<T extends SessionUserLike>(
  user: T | null | undefined,
): user is GuestSessionUser<T> {
  return user?.isAnonymous === true;
}

/**
 * True when the session belongs to a real (non-guest) account. Guest sessions
 * are invisible in the UI; guests still count toward the free daily search
 * limit. The predicate narrows both identity and the anonymous flag.
 */
export function isRegisteredSessionUser<T extends SessionUserLike>(
  user: T | null | undefined,
): user is RegisteredSessionUser<T> {
  return !!user && !isGuestSession(user);
}
