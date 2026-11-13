import { expect, test } from "bun:test";
import { parseCoutuModel } from "./coutu-parser";
import { coutuSnapshot } from "./coutu-snapshot";
import {
  coutuFixtureMake,
  coutuFixtureModel,
  coutuFixtureModelPage,
  coutuFixtureRecord,
} from "./coutu-test-fixtures";

test("oversized optional photo becomes null without rejecting required donor identity", () => {
  const record = coutuFixtureRecord(1);
  record[9] =
    "https://truckcountry.s3.amazonaws.com/vehicle/" +
    "a".repeat(1500) +
    ".jpg";
  const page = parseCoutuModel(
    coutuFixtureModelPage([record]),
    coutuFixtureMake,
    coutuFixtureModel,
    ["FORD"],
  );
  const snapshot = coutuSnapshot([page]);
  expect(snapshot.vehicles).toHaveLength(1);
  expect(snapshot.vehicles[0]?.imageUrl).toBeNull();
});

test("photo URL normalization cannot exceed the optional checkpoint bound", () => {
  const prefix = "https:truckcountry.s3.amazonaws.com/vehicle/";
  const suffix = ".jpg";
  const record = coutuFixtureRecord(1);
  record[9] =
    prefix + "a".repeat(1500 - prefix.length - suffix.length) + suffix;
  const page = parseCoutuModel(
    coutuFixtureModelPage([record]),
    coutuFixtureMake,
    coutuFixtureModel,
    ["FORD"],
  );
  const snapshot = coutuSnapshot([page]);
  expect(snapshot.vehicles).toHaveLength(1);
  expect(snapshot.vehicles[0]?.imageUrl).toBeNull();
});

test("a canonical native photo exactly at the optional checkpoint bound is preserved", () => {
  const prefix = "https://truckcountry.s3.amazonaws.com/vehicle/";
  const suffix = ".jpg";
  const record = coutuFixtureRecord(1);
  record[9] =
    prefix + "a".repeat(1500 - prefix.length - suffix.length) + suffix;
  const page = parseCoutuModel(
    coutuFixtureModelPage([record]),
    coutuFixtureMake,
    coutuFixtureModel,
    ["FORD"],
  );
  expect(record[9]).toHaveLength(1500);
  expect(coutuSnapshot([page]).vehicles[0]?.imageUrl).toBe(record[9]);
});
