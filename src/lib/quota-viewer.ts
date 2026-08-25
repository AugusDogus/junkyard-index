export type QuotaViewer =
  | { kind: "signed_out" }
  | { kind: "guest"; userId: string }
  | { kind: "authenticated"; userId: string };

type SessionUser = { id: string; isAnonymous?: boolean | null };

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
  liveUser: SessionUser | null | undefined,
): QuotaViewer {
  if (!liveUser) return initialViewer;
  return quotaViewerFromSessionUser(liveUser);
}
