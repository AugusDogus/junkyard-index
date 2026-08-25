export type QuotaViewer =
  | { kind: "signed_out" }
  | { kind: "guest"; userId: string }
  | { kind: "authenticated"; userId: string };

type SessionUser = { id: string; isAnonymous?: boolean | null };

export type LiveQuotaSession =
  | { kind: "loading" }
  | { kind: "resolved"; user: SessionUser | null };

interface AnonymousSignInResponse {
  data: unknown | null;
  error: unknown | null;
}

export function quotaViewerFromSessionUser(
  user: SessionUser | null | undefined,
): QuotaViewer {
  if (!user) return { kind: "signed_out" };
  return user.isAnonymous === true
    ? { kind: "guest", userId: user.id }
    : { kind: "authenticated", userId: user.id };
}

export function resolveQuotaViewer(
  initialViewer: QuotaViewer,
  liveSession: LiveQuotaSession,
): QuotaViewer {
  return liveSession.kind === "loading"
    ? initialViewer
    : quotaViewerFromSessionUser(liveSession.user);
}

export async function establishAnonymousQuotaSession(
  signInAnonymous: () => Promise<AnonymousSignInResponse>,
): Promise<"created" | "failed"> {
  try {
    const result = await signInAnonymous();
    return result.error === null && result.data !== null ? "created" : "failed";
  } catch {
    return "failed";
  }
}
