import { describe, expect, test } from "bun:test";
import type { ConsumerMode } from "~/server/ingestion/consumer-flags";
import {
  notificationDeliveryAllowed,
  triggerNotificationDelivery,
} from "./notification-delivery-trigger";

function harness(options: {
  mode?: ConsumerMode;
  alerts?: boolean;
  deliverable?: boolean;
}) {
  const calls: string[] = [];
  return {
    calls,
    run: () =>
      triggerNotificationDelivery({
        consumerMode: async () => {
          calls.push("consumer-flag");
          return options.mode ?? "enabled";
        },
        alertsEnabled: async () => {
          calls.push("alerts-flag");
          return options.alerts ?? true;
        },
        hasDeliverableIntents: async () => {
          calls.push("intents");
          return options.deliverable ?? true;
        },
        startDelivery: async () => {
          calls.push("start");
        },
      }),
  };
}

describe("notification-delivery consumer", () => {
  test("starts delivery when a notification can go out", async () => {
    const tick = harness({});
    expect(await tick.run()).toEqual({ status: "started" });
    expect(tick.calls).toEqual([
      "consumer-flag",
      "alerts-flag",
      "intents",
      "start",
    ]);
  });

  test("starts nothing when nothing is deliverable", async () => {
    const tick = harness({ deliverable: false });
    expect(await tick.run()).toEqual({ status: "idle" });
    expect(tick.calls).not.toContain("start");
  });

  test("a paused consumer reads no intents and starts nothing", async () => {
    const tick = harness({ mode: "paused" });
    expect(await tick.run()).toEqual({ status: "paused" });
    expect(tick.calls).toEqual(["consumer-flag"]);
  });

  test("alerts stay fail-closed even while the consumer flag is missing (enabled)", async () => {
    const tick = harness({ alerts: false });
    expect(await tick.run()).toEqual({ status: "alerts_disabled" });
    expect(tick.calls).toEqual(["consumer-flag", "alerts-flag"]);
  });

  test("every delivery batch needs both the consumer flag and the fail-closed alerts flag", () => {
    expect(
      notificationDeliveryAllowed({ consumer: "enabled", alerts: "enabled" }),
    ).toBe(true);
    expect(
      notificationDeliveryAllowed({ consumer: "paused", alerts: "enabled" }),
    ).toBe(false);
    expect(
      notificationDeliveryAllowed({ consumer: "enabled", alerts: "disabled" }),
    ).toBe(false);
  });
});
