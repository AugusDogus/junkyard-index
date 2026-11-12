import { expect, test } from "bun:test";
import { parseFenixInventory } from "./fenix-parser";
import {
  fenixTestPage,
  fenixTestRecord,
  fenixTestRow,
} from "./fenix-test-fixtures";

test("Fenix parses the native ten-column table and published terminal boundary", () => {
  const page = parseFenixInventory(fenixTestPage(), "elmira", "DESC", 1);
  expect(page.records).toEqual([fenixTestRecord]);
  expect(page.lastPage).toBe(1);
  expect(page.oppositeUrl).toContain("sort_direction=ASC&pg=1");
});

test("Fenix fails closed on missing rows, unknown columns and wrong ownership", () => {
  expect(() =>
    parseFenixInventory(
      fenixTestPage().replace("<th>VIN</th>", "<th>Other</th>"),
      "elmira",
      "DESC",
      1,
    ),
  ).toThrow("columns");
  expect(() =>
    parseFenixInventory(
      fenixTestPage(
        fenixTestRow({ ...fenixTestRecord, location: "Moultrie, GA" }),
      ),
      "elmira",
      "DESC",
      1,
    ),
  ).toThrow("ownership");
  expect(() =>
    parseFenixInventory(
      fenixTestPage().replace("</html>", ""),
      "elmira",
      "DESC",
      1,
    ),
  ).toThrow("truncated");
});

test("Fenix rejects invented sort links and unrelated detail destinations", () => {
  expect(() =>
    parseFenixInventory(
      fenixTestPage().replace(
        "sort_column=date_placed&sort_direction=ASC",
        "sort_column=stock&sort_direction=ASC",
      ),
      "elmira",
      "DESC",
      1,
    ),
  ).toThrow("sort");
  expect(() =>
    parseFenixInventory(
      fenixTestPage().replaceAll(
        "/inventory/204015747",
        "https://other.example/inventory/204015747",
      ),
      "elmira",
      "DESC",
      1,
    ),
  ).toThrow("detail");
});

test("Fenix does not promote unusable optional stock to an ownership failure", () => {
  expect(
    parseFenixInventory(
      fenixTestPage(fenixTestRow({ ...fenixTestRecord, stock: "0" })),
      "elmira",
      "DESC",
      1,
    ).records[0]?.stock,
  ).toBe("0");
});

test("Fenix retains published photos and nulls placeholders without rejecting rows", () => {
  expect(
    parseFenixInventory(fenixTestPage(), "elmira", "DESC", 1).records[0]
      ?.photoUrl,
  ).toBe(fenixTestRecord.photoUrl);
  const placeholder = fenixTestPage().replace(
    fenixTestRecord.photoUrl,
    "/wp-content/themes/fenixupull/assets/img/placeholder-150x100.jpg",
  );
  expect(
    parseFenixInventory(placeholder, "elmira", "DESC", 1).records[0]?.photoUrl,
  ).toBeNull();
});
