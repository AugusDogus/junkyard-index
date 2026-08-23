import { describe, expect, test } from "bun:test";
import { evaluateNotificationIntent } from "./notification-intent-policy";

const target = {
  searchMatchVersion: 2,
  emailConfigVersion: 3,
  discordConfigVersion: 4,
  emailAlertsEnabled: true,
  discordAlertsEnabled: true,
  emailStartSequence: 8,
  discordStartSequence: 10,
  discordReady: true,
};

describe("notification intent delivery policy", () => {
  test("evaluates each channel against its independent version and start sequence", () => {
    expect(
      evaluateNotificationIntent(
        {
          channel: "email",
          publicationSequence: 9,
          searchMatchVersion: 2,
          channelConfigVersion: 3,
        },
        target,
      ),
    ).toEqual({ status: "eligible" });
    expect(
      evaluateNotificationIntent(
        {
          channel: "discord",
          publicationSequence: 9,
          searchMatchVersion: 2,
          channelConfigVersion: 4,
        },
        target,
      ),
    ).toEqual({
      status: "cancel",
      reason: "channel_no_longer_eligible",
    });
  });

  test("cancels an intent when the search match definition changes", () => {
    expect(
      evaluateNotificationIntent(
        {
          channel: "email",
          publicationSequence: 11,
          searchMatchVersion: 1,
          channelConfigVersion: 3,
        },
        target,
      ),
    ).toEqual({
      status: "cancel",
      reason: "search_match_version_changed",
    });
  });
});
