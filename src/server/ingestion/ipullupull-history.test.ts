import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { vehicle } from "~/schema";
import { loadIPullUPullPublishedImages } from "./ipullupull-history";
import { ipullUPullPriorImageKey } from "./ipullupull-media";
import {
  SEARCH_PROJECTOR_TEST_SCHEMA,
  vehicleRow,
} from "./search-projector-test-fixtures";

test("reads only iPull-uPull listings that have a published image", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(SEARCH_PROJECTOR_TEST_SCHEMA);
  const database = drizzle(client);
  const image =
    "https://ipullupull.com/wp-content/uploads/ipullupull-optimized/1b/1b9b8138b8961f0f-large.webp";
  await database.insert(vehicle).values([
    vehicleRow("1FMCU49H37KA40424", {
      source: "ipullupull",
      stockNumber: "FRE117278",
      imageUrl: image,
    }),
    vehicleRow("2T1KR32E33C019919", {
      source: "ipullupull",
      stockNumber: "POM067262",
      imageUrl: null,
    }),
    vehicleRow("1GCEC14X35Z238308", {
      source: "ipullupull",
      stockNumber: null,
      imageUrl: image,
    }),
    vehicleRow("2V4RW3DG3BR625750", {
      source: "pyp",
      stockNumber: "STK058972",
      imageUrl: image,
    }),
  ]);
  expect(await loadIPullUPullPublishedImages(database)).toEqual(
    new Map([
      [ipullUPullPriorImageKey("FRE117278", "1FMCU49H37KA40424"), image],
    ]),
  );
});
