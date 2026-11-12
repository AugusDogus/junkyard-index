import { expect, test } from "bun:test";
import { parseTritownContext, parseTritownPage } from "./tritown-parser";
import {
  tritownTestCard,
  tritownTestContext,
  tritownTestPage,
} from "./tritown-test-fixtures";
import { transformTritownRecord } from "./tritown-transform";

test("TriTown validates genuine pre-1981 serials without padding or VIN decoding", () => {
  const page = parseTritownPage(
    tritownTestPage(1, 1, [
      tritownTestCard(1, { title: "1979 Jeep CJ-5", vin: "J9F83AC851237" }),
    ]),
    1,
  );
  const record = page.records[0];
  if (!record) throw new Error("Missing test donor");
  const donor = transformTritownRecord(record, ["Jeep"]);
  expect(donor.status).toBe("available");
  if (donor.status === "available")
    expect(donor.vehicle.vin).toBe("J9F83AC851237");
});

test("TriTown rejects short, truncated, foreign-owner and unavailable listing pages", () => {
  const card = tritownTestCard(1);
  const bodies = [
    tritownTestPage(1, 2, [card]),
    tritownTestPage(1, 1, [card.replace(/<\/li>$/, "")]),
    tritownTestPage(1, 1, [
      card.replace("tritownautosalvage.com/vehicle", "example.com/vehicle"),
    ]),
    tritownTestPage(1, 1, [card.replace("Row 2A", "HOLD")]),
  ];
  for (const body of bodies) expect(() => parseTritownPage(body, 1)).toThrow();
});

test("TriTown requires the native complete-inventory statement and verified AJAX endpoint", () => {
  expect(parseTritownContext(tritownTestContext).nonce).toBe("6a9d8ed595");
  expect(() =>
    parseTritownContext(
      tritownTestContext.replace(
        "most up to date inventory",
        "recent arrivals",
      ),
    ),
  ).toThrow("active");
  expect(() =>
    parseTritownContext(
      tritownTestContext.replace(
        "/?wpcm-ajax=get_vehicle_results",
        "/?wpcm-ajax=other",
      ),
    ),
  ).toThrow();
});

test("TriTown retains VIN presence but rejects a native trashed donor destination", () => {
  const raw = tritownTestPage(1, 1, [tritownTestCard(1)]).replace(
    "/test-1/",
    "/__trashed/",
  );
  const record = parseTritownPage(raw, 1).records[0];
  if (!record) throw new Error("Missing test donor");
  expect(transformTritownRecord(record, ["Chevrolet"])).toEqual({
    status: "incomplete",
    vin: "2CNALBEW8A0000001",
  });
});
