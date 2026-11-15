import { expect, test } from "bun:test";
import { z } from "zod";
import { ALLIED_YARD } from "./allied-configuration";
import { alliedFixture } from "./allied-test-fixtures";

test("Allied coordinates come from an exact Census match of its published address", () => {
  const response = z
    .object({
      result: z.object({
        addressMatches: z
          .array(
            z.object({
              matchedAddress: z.string(),
              coordinates: z.object({ x: z.number(), y: z.number() }),
              addressComponents: z.object({
                city: z.string(),
                state: z.string(),
                zip: z.string(),
              }),
            }),
          )
          .length(1),
      }),
    })
    .parse(JSON.parse(alliedFixture("census")));
  const match = response.result.addressMatches[0];
  if (!match) throw new Error("Missing saved Census match");
  expect(match.matchedAddress).toBe("32 DUSTIN TAVERN RD, WEARE, NH, 03281");
  expect(match.addressComponents).toEqual({
    city: "WEARE",
    state: ALLIED_YARD.state,
    zip: ALLIED_YARD.postalCode,
  });
  expect({ lat: match.coordinates.y, lng: match.coordinates.x }).toEqual({
    lat: ALLIED_YARD.lat,
    lng: ALLIED_YARD.lng,
  });
});
