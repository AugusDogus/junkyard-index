import { expect, test } from "bun:test";
import { ModelArrivals, type ModelArrivalCandidate } from "./model-arrivals";

function candidate(
  vin: string,
  overrides: Partial<ModelArrivalCandidate> = {},
): ModelArrivalCandidate {
  return {
    vin,
    source: "pyp",
    code: "one",
    imageUrl: "https://photos.example.com/car.jpg",
    addedAt: 100,
    ...overrides,
  };
}

test("a photo-less ingestion batch cannot fill the model showcase", () => {
  const batch = Array.from({ length: 30 }, (_, index) =>
    candidate(`batch-${index}`, { imageUrl: null, addedAt: 1000 + index }),
  );
  const photos = [candidate("photo-a"), candidate("photo-b", { code: "two" })];
  const picked = ModelArrivals.pick([...batch, ...photos], 24);
  expect(picked).toHaveLength(24);
  expect(picked.slice(0, 2).map(({ vin }) => vin)).toEqual([
    "photo-a",
    "photo-b",
  ]);
});

test("mixes yards before repeating, preserving newest order in each round", () => {
  const rows = [
    candidate("one-new", { addedAt: 300 }),
    candidate("one-old", { addedAt: 200 }),
    candidate("two", { code: "two", addedAt: 100 }),
    candidate("other-source", { source: "pullapart", addedAt: 50 }),
  ];
  expect(ModelArrivals.pick(rows, 3).map(({ vin }) => vin)).toEqual([
    "one-new",
    "two",
    "other-source",
  ]);
  expect(ModelArrivals.pick(rows, 10).map(({ vin }) => vin)).toEqual([
    "one-new",
    "two",
    "other-source",
    "one-old",
  ]);
  expect(rows.map(({ vin }) => vin)).toEqual([
    "one-new",
    "one-old",
    "two",
    "other-source",
  ]);
});

test("fills sparse and photo-less models with deterministic ties", () => {
  const rows = [
    candidate("b", { imageUrl: null }),
    candidate("a", { imageUrl: "   " }),
    candidate("c", { imageUrl: null }),
  ];
  expect(ModelArrivals.pick(rows, 24).map(({ vin }) => vin)).toEqual([
    "a",
    "b",
    "c",
  ]);
  expect(ModelArrivals.pick([], 24)).toEqual([]);
});
