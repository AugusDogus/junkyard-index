import type { Yard } from "~/lib/yard";
import type { z } from "zod";
import type { PickNSaveYardCodeSchema } from "./picknsave-cursor";

export type PickNSaveYard = Yard & {
  source: "picknsave";
  code: z.infer<typeof PickNSaveYardCodeSchema>;
};

// Official location pages and their linked Google business pins, verified 2026-11-11.
// /lynchburg/ links https://maps.app.goo.gl/97ZkBomyWLUfVfZG6.
// /roanoke/ links https://maps.app.goo.gl/k1cW1aHnExtXTGys7.
export const PICKNSAVE_YARDS: readonly PickNSaveYard[] = [
  {
    source: "picknsave",
    code: "PNS-VA-LYNCHBURG",
    name: "Pick-n-Save - Lynchburg",
    operator: "Pick-n-Save",
    address: "10786 Wards Road",
    city: "Rustburg",
    state: "VA",
    postalCode: "24588",
    lat: 37.277841,
    lng: -79.1706823,
    websiteUrl: "https://pick-n-save.net/lynchburg/",
    phone: "434-338-6700",
    email: null,
  },
  {
    source: "picknsave",
    code: "PNS-VA-ROANOKE",
    name: "Pick-n-Save - Roanoke",
    operator: "Pick-n-Save",
    address: "3002 Sleepy Ln NE",
    city: "Roanoke",
    state: "VA",
    postalCode: "24012",
    lat: 37.2994744,
    lng: -79.8985253,
    websiteUrl: "https://pick-n-save.net/roanoke/",
    phone: "800-227-7315",
    email: null,
  },
];
