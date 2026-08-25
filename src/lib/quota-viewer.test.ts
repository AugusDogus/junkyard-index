import { describe, expect, test } from "bun:test";
import { quotaViewerFromSessionUser, resolveQuotaViewer } from "./quota-viewer";

describe("quotaViewerFromSessionUser", () => {
  test("distinguishes signed-out and authenticated viewers", () => {
    expect(quotaViewerFromSessionUser(undefined)).toEqual({
      kind: "signed_out",
    });
    expect(quotaViewerFromSessionUser({ id: "user-1" })).toEqual({
      kind: "authenticated",
      userId: "user-1",
    });
  });
});

describe("resolveQuotaViewer", () => {
  test("keeps the server identity while the client session hydrates", () => {
    const viewer = { kind: "authenticated", userId: "user-1" } as const;
    expect(resolveQuotaViewer(viewer, { kind: "loading" })).toEqual(viewer);
  });

  test("keeps the server identity when session refresh fails", () => {
    const viewer = { kind: "authenticated", userId: "user-1" } as const;
    expect(resolveQuotaViewer(viewer, { kind: "failed" })).toEqual(viewer);
  });

  test("adopts an authenticated session after sign-in", () => {
    expect(
      resolveQuotaViewer(
        { kind: "signed_out" },
        { kind: "resolved", user: { id: "user-1" } },
      ),
    ).toEqual({ kind: "authenticated", userId: "user-1" });
  });

  test("adopts a confirmed sign-out", () => {
    expect(
      resolveQuotaViewer(
        { kind: "authenticated", userId: "user-1" },
        { kind: "resolved", user: null },
      ),
    ).toEqual({ kind: "signed_out" });
  });
});
