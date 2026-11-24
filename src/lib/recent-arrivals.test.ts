import { expect, test } from "bun:test";
import { RecentArrivals } from "./recent-arrivals";

const car = (
  make: string,
  model: string,
  imageUrl: string | null = "x",
  yard = "1",
) => ({
  make,
  model,
  imageUrl,
  source: "pyp",
  locationCode: yard,
});

test("keeps one of each model, photos first, in order", () => {
  const picked = RecentArrivals.pick(
    [
      car("Acura", "TL"),
      car("ACURA", "TL"),
      car("Buick", "Riviera", null),
      car("Acura", "TL"),
      car("Honda", "Civic"),
      car("Ford", "F150"),
    ],
    3,
  );
  expect(picked.map((vehicle) => `${vehicle.make} ${vehicle.model}`)).toEqual([
    "Acura TL",
    "Honda Civic",
    "Ford F150",
  ]);
});

test("repeats models only when there are too few to fill the count", () => {
  const picked = RecentArrivals.pick(
    [car("Acura", "TL"), car("Acura", "TL"), car("Honda", "Civic")],
    3,
  );
  expect(picked.map((vehicle) => vehicle.model)).toEqual(["TL", "Civic", "TL"]);
});

test("takes one arrival from each yard before a second from any", () => {
  const batch = ["Civic", "Accord", "Fit", "Pilot", "Odyssey"].map((model) =>
    car("Honda", model, "x", "pontiac"),
  );
  const picked = RecentArrivals.pick(
    [
      ...batch,
      car("Ford", "Focus", "x", "dallas"),
      car("Kia", "Soul", null, "tulsa"),
      car("Ford", "Ranger", "x", "dallas"),
    ],
    4,
  );
  expect(picked.map((vehicle) => vehicle.model)).toEqual([
    "Civic",
    "Focus",
    "Accord",
    "Ranger",
  ]);
});
