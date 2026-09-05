import { describe, expect, test } from "bun:test";
import { sortYardsByDistance } from "./yard-directory";

const yards = [
  { name: "Los Angeles", lat: 34.05, lng: -118.24 },
  { name: "Missing", lat: null, lng: null },
  { name: "Chicago", lat: 41.88, lng: -87.63 },
  { name: "Milwaukee", lat: 43.04, lng: -87.91 },
];

describe("yard directory distance order", () => {
  test("puts the nearest yards first and yards without coordinates last", () => {
    expect(
      sortYardsByDistance(yards, { lat: 41.88, lng: -87.63 }).map(
        (yard) => yard.name,
      ),
    ).toEqual(["Chicago", "Milwaukee", "Los Angeles", "Missing"]);
    expect(yards[0]?.name).toBe("Los Angeles");
  });

  test("keeps directory order when the visitor's location is unavailable or invalid", () => {
    expect(sortYardsByDistance(yards, null)).toEqual(yards);
    expect(sortYardsByDistance(yards, { lat: 95, lng: 0 })).toEqual(yards);
  });

  test("keeps equal-distance yards in order and treats invalid coordinates as missing", () => {
    const nearby = [
      { name: "Invalid", lat: 100, lng: 0 },
      { name: "First", lat: 0, lng: 0 },
      { name: "Second", lat: 0, lng: 0 },
    ];
    expect(
      sortYardsByDistance(nearby, { lat: 0, lng: 0 }).map((yard) => yard.name),
    ).toEqual(["First", "Second", "Invalid"]);
  });
});
