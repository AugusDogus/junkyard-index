export type QuotaViewer =
  | { kind: "signed_out" }
  | { kind: "guest"; userId: string }
  | { kind: "authenticated"; userId: string };

type SessionUser = { id: string; isAnonymous?: boolean | null };

export function resolveQuotaViewer(
  initialViewer: QuotaViewer,
  liveUser: SessionUser | null | undefined,
): QuotaViewer {
  if (!liveUser) return initialViewer;
  return liveUser.isAnonymous === true
    ? { kind: "guest", userId: liveUser.id }
    : { kind: "authenticated", userId: liveUser.id };
}
