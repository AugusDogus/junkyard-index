import { describe, expect, test } from "bun:test";
import {
  prepareAccountDeletion,
  type AccountSubscription,
} from "./account-deletion";

function subscription(id: string, cancelAtPeriodEnd = false) {
  return { id, cancelAtPeriodEnd } satisfies AccountSubscription;
}

describe("account deletion preparation", () => {
  test("stops each renewing subscription and skips subscriptions already canceled", async () => {
    const stopped: string[] = [];

    const result = await prepareAccountDeletion("user-1", {
      listActive: async () => [
        subscription("sub-1"),
        subscription("sub-2", true),
      ],
      stopRenewal: async (id) => {
        stopped.push(id);
      },
    });

    expect(result).toEqual({ status: "ready", stoppedRenewals: 1 });
    expect(stopped).toEqual(["sub-1"]);
  });

  test("preserves the account when subscription lookup fails", async () => {
    const cause = new Error("Polar unavailable");

    const result = await prepareAccountDeletion("user-1", {
      listActive: async () => {
        throw cause;
      },
      stopRenewal: async () => {},
    });

    expect(result).toMatchObject({
      status: "failed",
      stoppedRenewals: 0,
      cause,
    });
  });

  test("reports partial cancellation and preserves the account when a cancellation fails", async () => {
    const stopped: string[] = [];

    const result = await prepareAccountDeletion("user-1", {
      listActive: async () => [subscription("sub-1"), subscription("sub-2")],
      stopRenewal: async (id) => {
        if (id === "sub-2") throw new Error("Polar unavailable");
        stopped.push(id);
      },
    });

    expect(result).toMatchObject({ status: "failed", stoppedRenewals: 1 });
    expect(stopped).toEqual(["sub-1"]);
  });
});
