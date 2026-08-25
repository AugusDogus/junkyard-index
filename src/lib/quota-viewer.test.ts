import { describe, expect, test } from "bun:test";
import {
  establishAnonymousQuotaSession,
  quotaViewerFromSessionUser,
  resolveQuotaViewer,
} from "./quota-viewer";

describe("quotaViewerFromSessionUser", () => {
  test("models each session identity as one valid viewer state", () => {
    expect(quotaViewerFromSessionUser(undefined)).toEqual({
      kind: "signed_out",
    });
    expect(
      quotaViewerFromSessionUser({ id: "guest-1", isAnonymous: true }),
    ).toEqual({ kind: "guest", userId: "guest-1" });
    expect(
      quotaViewerFromSessionUser({ id: "user-1", isAnonymous: false }),
    ).toEqual({ kind: "authenticated", userId: "user-1" });
  });
});

describe("resolveQuotaViewer", () => {
  test("keeps the server identity while the client session hydrates", () => {
    expect(
      resolveQuotaViewer(
        { kind: "guest", userId: "guest-1" },
        { kind: "loading" },
      ),
    ).toEqual({ kind: "guest", userId: "guest-1" });
  });

  test("adopts a guest identity only after anonymous sign-in completes", () => {
    expect(
      resolveQuotaViewer({ kind: "signed_out" }, { kind: "loading" }),
    ).toEqual({ kind: "signed_out" });
    expect(
      resolveQuotaViewer(
        { kind: "signed_out" },
        {
          kind: "resolved",
          user: { id: "guest-1", isAnonymous: true },
        },
      ),
    ).toEqual({ kind: "guest", userId: "guest-1" });
  });

  test("replaces a prior identity after an account change", () => {
    expect(
      resolveQuotaViewer(
        { kind: "guest", userId: "guest-1" },
        {
          kind: "resolved",
          user: { id: "user-1", isAnonymous: false },
        },
      ),
    ).toEqual({ kind: "authenticated", userId: "user-1" });
  });

  test("replaces the server identity after a resolved sign-out", () => {
    expect(
      resolveQuotaViewer(
        { kind: "authenticated", userId: "user-1" },
        { kind: "resolved", user: null },
      ),
    ).toEqual({ kind: "signed_out" });
  });
});

describe("establishAnonymousQuotaSession", () => {
  test("fails when Better Auth resolves an HTTP error response", async () => {
    await expect(
      establishAnonymousQuotaSession(async () => ({
        data: null,
        error: { message: "request failed" },
      })),
    ).resolves.toBe("failed");
  });

  test("distinguishes successful and thrown sign-in requests", async () => {
    await expect(
      establishAnonymousQuotaSession(async () => ({
        data: { token: "guest-session" },
        error: null,
      })),
    ).resolves.toBe("created");
    await expect(
      establishAnonymousQuotaSession(async () => {
        throw new Error("network unavailable");
      }),
    ).resolves.toBe("failed");
  });
});
