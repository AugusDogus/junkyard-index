import { expect, test } from "bun:test";
import { transformPullsavewaRecord } from "./pullsavewa-transform";
import { pullsavewaTestMead } from "./pullsavewa-test-fixtures";
import type { PullsavewaRecord } from "./pullsavewa-parser";

const record: PullsavewaRecord = {
  stock: "",
  row: "",
  date: "",
  vin: "6001032574",
  year: "1961",
  make: "FORD",
  model: "GALAXIE",
  detailsUrl: pullsavewaTestMead.inventoryUrl,
  nativeImageUrl: null,
};
test("Pull & Save accepts native historical serial and absent optional metadata", () => {
  const result = transformPullsavewaRecord(record, pullsavewaTestMead);
  expect(result.status).toBe("available");
  if (result.status !== "available")
    throw new Error("Expected available donor");
  expect(result.vehicle).toMatchObject({
    vin: "6001032574",
    year: 1961,
    make: "Ford",
    model: "GALAXIE",
    color: null,
    stockNumber: null,
    imageUrl: null,
    availableDate: null,
    row: null,
  });
});

test("Pull & Save preserves valid rejected presence and does not repair invalid modern VINs", () => {
  expect(
    transformPullsavewaRecord({ ...record, make: "" }, pullsavewaTestMead),
  ).toEqual({ status: "incomplete", vin: record.vin });
  expect(
    transformPullsavewaRecord(
      { ...record, year: "1993", vin: "AP3039304" },
      pullsavewaTestMead,
    ),
  ).toEqual({ status: "incomplete", vin: null });
  expect(
    transformPullsavewaRecord(
      { ...record, vin: "1HGCM82633A00O352", year: "2003" },
      pullsavewaTestMead,
    ),
  ).toEqual({ status: "incomplete", vin: null });
});

test("Pull & Save rejects explicit unavailability, preserves unexplained SCRP and lowercase native stock", () => {
  for (const row of ["HOLD", "CRUSH", "SOLD", "UNAVAILABLE"])
    expect(
      transformPullsavewaRecord({ ...record, row }, pullsavewaTestMead),
    ).toEqual({ status: "incomplete", vin: record.vin });
  const result = transformPullsavewaRecord(
    { ...record, row: "SCRP", stock: "205ep" },
    pullsavewaTestMead,
  );
  expect(result.status === "available" && result.vehicle.row).toBe("SCRP");
  expect(result.status === "available" && result.vehicle.stockNumber).toBe(
    "205ep",
  );
});

test("Pull & Save source dates must be calendar-valid and not future", () => {
  for (const date of ["", "02/30/2024", "2024-01-01", "01/01/2100"]) {
    const result = transformPullsavewaRecord(
      { ...record, date },
      pullsavewaTestMead,
    );
    expect(
      result.status === "available" && result.vehicle.availableDate,
    ).toBeNull();
  }
  const result = transformPullsavewaRecord(
    { ...record, date: "02/29/2024" },
    pullsavewaTestMead,
  );
  expect(result.status === "available" && result.vehicle.availableDate).toBe(
    "2024-02-29T00:00:00.000Z",
  );
});

test("Pull & Save preserves a genuine native stock-bound photo without filename inference", () => {
  const nativeImageUrl =
    "https://newautopart.net/includes/pullandsave/mead_photos/311129_01.jpg";
  const result = transformPullsavewaRecord(
    {
      ...record,
      detailsUrl:
        "https://newautopart.net/includes/pullandsave/mead/yard_locationsview.php?showdetail=&Stock_Ticket=224EV",
      stock: "224EV",
      nativeImageUrl,
    },
    pullsavewaTestMead,
  );
  expect(result.status === "available" && result.vehicle.imageUrl).toBe(
    nativeImageUrl,
  );
});

test("Pull & Save invalid optional photos and placeholders remain null with valid required fields", () => {
  const photo =
    "https://newautopart.net/includes/pullandsave/mead_photos/311129_01.jpg";
  for (const nativeImageUrl of [
    null,
    "",
    "data:image/png;base64,x",
    photo.replace("newautopart.net", "other.example"),
    photo.replace("mead_photos", "spokane_photos"),
    photo.replace("311129_01", "placeholder"),
    photo + "?x=1",
    photo + "#x",
    photo.replace("https://", "https://user:pass@"),
    photo.replace("mead_photos/", "mead_photos/../mead_photos/"),
  ]) {
    const result = transformPullsavewaRecord(
      {
        ...record,
        detailsUrl:
          "https://newautopart.net/includes/pullandsave/mead/yard_locationsview.php?showdetail=&Stock_Ticket=224EV",
        stock: "224EV",
        nativeImageUrl,
      },
      pullsavewaTestMead,
    );
    expect(result.status).toBe("available");
    expect(result.status === "available" && result.vehicle.imageUrl).toBeNull();
  }
});

test("Pull & Save rejects unusable required descriptions and nulls optional placeholders", () => {
  for (const value of ["-", "N-A", "NULL", "None", "000"])
    for (const field of ["make", "model"])
      expect(
        transformPullsavewaRecord(
          { ...record, [field]: value },
          pullsavewaTestMead,
        ),
      ).toEqual({ status: "incomplete", vin: record.vin });
  expect(
    transformPullsavewaRecord({ ...record, make: "123" }, pullsavewaTestMead)
      .status,
  ).toBe("incomplete");
  for (const value of ["NULL", "Unknown", "0", "None", "--"]) {
    const result = transformPullsavewaRecord(
      { ...record, stock: value, row: value },
      pullsavewaTestMead,
    );
    expect(
      result.status === "available" && result.vehicle.stockNumber,
    ).toBeNull();
    expect(result.status === "available" && result.vehicle.row).toBeNull();
  }
});
