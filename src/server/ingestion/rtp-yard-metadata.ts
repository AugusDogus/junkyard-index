import type { RtpYardCode } from "./rtp-cursor";

export const RTP_ORIGIN = "https://upullandsave.com";
// Native YardSmart IDs, not the site's separate location identifiers.
// All five yards passed the required-field audit on 2026-11-12.
// Keep existing checkpoints in order, then enumerate the newly admitted yards.
export const RTP_YARDS = {
  "595": {
    home: `${RTP_ORIGIN}/lexington-ky/rtp-pick-a-part/`,
    state: "KY",
    next: "1189",
  },
  "1189": {
    home: `${RTP_ORIGIN}/maiden-nc/rtp-pick-a-part/`,
    state: "NC",
    next: "232",
  },
  "232": {
    home: `${RTP_ORIGIN}/hebron-ky/rtp-pick-a-part/`,
    state: "KY",
    next: "265",
  },
  "265": {
    home: `${RTP_ORIGIN}/louisville-ky/rtp-pick-a-part/`,
    state: "KY",
    next: "298",
  },
  "298": {
    home: `${RTP_ORIGIN}/savannah-tn/raceway-pik-a-part/`,
    state: "TN",
    next: null,
  },
} as const satisfies Record<
  RtpYardCode,
  {
    home: string;
    state: string;
    next: RtpYardCode | null;
  }
>;
