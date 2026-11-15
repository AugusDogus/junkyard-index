import { expect, test } from "bun:test";
import {
  AlshnedCatalog,
  AlshnedDonor,
  ALSHNED_CATALOG,
} from "./alshned-parser";
import { alshnedFixture } from "./alshned-test-fixtures";
import { assessAlshnedDonor } from "./alshned-transform";
const first = AlshnedCatalog.parse(
  alshnedFixture("opening-collection"),
  ALSHNED_CATALOG,
);
function donor(index: number) {
  const card = first.cards[index - 1];
  if (!card) throw new Error("Actual Alshned card absent");
  return AlshnedDonor.parse(
    alshnedFixture("detail-" + String(index).padStart(2, "0")),
    card,
  );
}
test("accepted actual identity retains source model description and optional metadata", () => {
  const a = assessAlshnedDonor(donor(1));
  expect(a.status).toBe("accepted");
  if (a.status !== "accepted") throw new Error("Actual donor rejected");
  expect(a.vehicle).toMatchObject({
    source: "alshned",
    vin: "5N1AZ2MH8GN108848",
    year: 2016,
    make: "Nissan",
    model: "Murano Platinum Brown",
    stockNumber: "0D0044",
    stateAbbr: "PA",
    availableDate: null,
    row: null,
  });
});
test("actual Ram/Dodge and F150/F-150 conflicts remain required rejects", () => {
  expect(assessAlshnedDonor(donor(9))).toMatchObject({
    status: "rejected",
    reasons: ["conflicting-native-make"],
  });
  expect(assessAlshnedDonor(donor(22))).toMatchObject({
    status: "rejected",
    reasons: ["conflicting-native-heading"],
  });
});
test("missing optional values pass while required identity conflicts fail", () => {
  const d = donor(1);
  expect(
    assessAlshnedDonor({ ...d, stock: null, imageUrl: null, fields: {} })
      .status,
  ).toBe("accepted");
  for (const changed of [
    { ...d, vin: "" },
    { ...d, jsonVin: "1FTEX1EPXKFB32261" },
    { ...d, title: "Donor vehicle 2017 Nissan Murano Platinum Brown" },
  ])
    expect(assessAlshnedDonor(changed).status).toBe("rejected");
});

test("extra independent VIN claims are preserved and conflicting identities rejected", () => {
  const d = donor(1);
  const a = assessAlshnedDonor({
    ...d,
    vinClaims: [...d.vinClaims, "1FTEX1EPXKFB32261"],
  });
  expect(a.status).toBe("rejected");
  expect(a.observedVins).toEqual(["5N1AZ2MH8GN108848", "1FTEX1EPXKFB32261"]);
});
test("foreign optional images become null without changing required acceptance", () => {
  const a = assessAlshnedDonor({
    ...donor(1),
    imageUrl: "https://foreign.invalid/photo.jpg",
  });
  expect(a.status).toBe("accepted");
  if (a.status !== "accepted")
    throw new Error("Required donor unexpectedly rejected");
  expect(a.vehicle.imageUrl).toBeNull();
});

test("inactive native donors are excluded", () => {
  expect(assessAlshnedDonor({ ...donor(1), active: false }).status).toBe(
    "excluded",
  );
});
