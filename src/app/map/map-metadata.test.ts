import { expect, test } from "bun:test";
import { mapMetadata } from "./map-metadata";

test("the yard map is its own canonical page", () => {
  expect(mapMetadata.title).toBe("Salvage Yard Map");
  expect(mapMetadata.alternates?.canonical).toBe("/map");
  expect(mapMetadata.openGraph).toMatchObject({
    siteName: "Junkyard Index",
    url: "/map",
    title: "Salvage Yard Map",
  });
  expect(typeof mapMetadata.description).toBe("string");
});
