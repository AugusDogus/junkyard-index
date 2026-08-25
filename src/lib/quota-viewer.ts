export type QuotaViewer =
  | { kind: "signed_out" }
  | { kind: "authenticated"; userId: string };

type SessionUser = { id: string };

export type LiveQuotaSession =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "resolved"; user: SessionUser | null };

export function quotaViewerFromSessionUser(
  user: SessionUser | null | undefined,
): QuotaViewer {
  return user
    ? { kind: "authenticated", userId: user.id }
    : { kind: "signed_out" };
}

export function resolveQuotaViewer(
  initialViewer: QuotaViewer,
  liveSession: LiveQuotaSession,
): QuotaViewer {
  return liveSession.kind === "resolved"
    ? quotaViewerFromSessionUser(liveSession.user)
    : initialViewer;
}
