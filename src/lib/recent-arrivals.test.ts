import { expect, test } from "bun:test";
import { RecentArrivals } from "./recent-arrivals";

const car = (make: string, model: string, imageUrl: string | null = "x") => ({
  make,
  model,
  imageUrl,
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
