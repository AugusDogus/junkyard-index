import { queue } from "@trigger.dev/sdk";

export const algoliaWritesQueue = queue({
  name: "algolia-writes",
  concurrencyLimit: 1,
});
