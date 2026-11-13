import type { Cars4PartsContract } from "./cars4parts-contract";
import { CARS4PARTS_ORIGIN } from "./cars4parts-html";

// Native record-level branch labels and independent business markers are
// retained in coverage/parallel-ak-hi physical reviews54 and55. Complete
// published census:69 accepted Heyworth donors and2 Armington donors.
export const CARS4PARTS_CONTRACT = {
  heyworth: {
    yard: {
      source: "cars4parts",
      code: "heyworth",
      name: "Carz R Us 1",
      operator: "Carz R Us 1",
      address: "1281 W Cleveland Street",
      city: "Heyworth",
      state: "IL",
      postalCode: "61745",
      phone: "309-220-8410",
      email: null,
      lat: 40.312453,
      lng: -88.9935285,
      websiteUrl: CARS4PARTS_ORIGIN + "/",
    },
    minimumUniqueInventory: 55,
  },
  armington: {
    yard: {
      source: "cars4parts",
      code: "armington",
      name: "Carz R Us 1",
      operator: "Carz R Us 1",
      address: "614 W. 3Rd Street",
      city: "Armington",
      state: "IL",
      postalCode: "61721",
      phone: "309-392-2000",
      email: null,
      lat: 40.3376265,
      lng: -89.3186942,
      websiteUrl: CARS4PARTS_ORIGIN + "/",
    },
    minimumUniqueInventory: 1,
  },
} satisfies Cars4PartsContract;
