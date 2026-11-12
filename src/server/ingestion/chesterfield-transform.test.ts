import { expect, test } from "bun:test";
import { ChesterfieldDonor } from "./chesterfield-donor";
import { chesterfieldRecord } from "./chesterfield-test-fixtures";
import { transformChesterfieldDonor } from "./chesterfield-transform";

test("missing photo metadata stays null at the canonical boundary", () => {
  const result = ChesterfieldDonor.parse({ ...chesterfieldRecord, images: [] });
  if (result.status !== "available") throw new Error("Expected native donor");
  expect(
    transformChesterfieldDonor(result.donor, null, "https://index.example")
      .imageUrl,
  ).toBeNull();
  expect(() =>
    transformChesterfieldDonor(
      result.donor,
      "a".repeat(64),
      "https://index.example",
    ),
  ).toThrow("no preserved content hash");
});

test("a published photo cannot be silently dropped at the canonical boundary", () => {
  const result = ChesterfieldDonor.parse(chesterfieldRecord);
  if (result.status !== "available") throw new Error("Expected native donor");
  expect(() =>
    transformChesterfieldDonor(result.donor, null, "https://index.example"),
  ).toThrow("no preserved content hash");
});
