import { describe, expect, test } from "bun:test";
import { resolveQuotaViewer } from "./quota-viewer";

describe("resolveQuotaViewer", () => {
  test("keeps the server identity while the client session hydrates", () => {
    expect(
      resolveQuotaViewer({ kind: "guest", userId: "guest-1" }, undefined),
    ).toEqual({ kind: "guest", userId: "guest-1" });
  });

  test("adopts a guest identity only after anonymous sign-in completes", () => {
    expect(resolveQuotaViewer({ kind: "signed_out" }, undefined)).toEqual({
      kind: "signed_out",
    });
    expect(
      resolveQuotaViewer(
        { kind: "signed_out" },
        { id: "guest-1", isAnonymous: true },
      ),
    ).toEqual({ kind: "guest", userId: "guest-1" });
  });

  test("replaces a prior identity after an account change", () => {
    expect(
      resolveQuotaViewer(
        { kind: "guest", userId: "guest-1" },
        { id: "user-1", isAnonymous: false },
      ),
    ).toEqual({ kind: "authenticated", userId: "user-1" });
  });
});
