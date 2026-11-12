import { expect, test } from "bun:test";
import {
  parsePullsavewaPage,
  validatePullsavewaSnapshot,
} from "./pullsavewa-parser";
import {
  pullsavewaTestMead,
  pullsavewaTestPage,
  pullsavewaTestRow,
} from "./pullsavewa-test-fixtures";

test("Pull & Save ALL census matches fresh first and terminal native fields", () => {
  const first = parsePullsavewaPage(
    pullsavewaTestPage("first"),
    pullsavewaTestMead,
    "first",
  );
  const all = parsePullsavewaPage(
    pullsavewaTestPage("all"),
    pullsavewaTestMead,
    "all",
  );
  const last = parsePullsavewaPage(
    pullsavewaTestPage("last"),
    pullsavewaTestMead,
    "last",
  );
  expect(validatePullsavewaSnapshot(first, all, last)).toHaveLength(21);
  expect(first.terminalUrl).toBe(pullsavewaTestMead.inventoryUrl + "?start=21");
});

test("Pull & Save rejects ignored ALL, incomplete markup, changed headers and foreign details", () => {
  for (const body of [
    pullsavewaTestPage("first"),
    pullsavewaTestPage("all").replace("</tbody>", ""),
    pullsavewaTestPage("all").replace('data-name="Vin"', 'data-name="Other"'),
    pullsavewaTestPage("all").replace(
      "yard_locationsview.php?",
      "https://other.example/yard_locationsview.php?",
    ),
  ])
    expect(() =>
      parsePullsavewaPage(body, pullsavewaTestMead, "all"),
    ).toThrow();
});

test("Pull & Save rejects changed census, terminal parity and duplicate native stocks", () => {
  const first = parsePullsavewaPage(
    pullsavewaTestPage("first"),
    pullsavewaTestMead,
    "first",
  );
  const all = parsePullsavewaPage(
    pullsavewaTestPage("all"),
    pullsavewaTestMead,
    "all",
  );
  const last = parsePullsavewaPage(
    pullsavewaTestPage("last"),
    pullsavewaTestMead,
    "last",
  );
  expect(() =>
    validatePullsavewaSnapshot({ ...first, total: 22 }, all, last),
  ).toThrow();
  expect(() =>
    validatePullsavewaSnapshot(first, all, {
      ...last,
      records: last.records.map((row) => ({ ...row, model: "OTHER" })),
    }),
  ).toThrow();
  const duplicates = [pullsavewaTestRow(1), pullsavewaTestRow(1)];
  expect(() =>
    parsePullsavewaPage(
      pullsavewaTestPage("all", duplicates),
      pullsavewaTestMead,
      "all",
    ),
  ).toThrow("duplicate");
  const reordered = pullsavewaTestRow(1).replaceAll(
    "yard_locationsview.php?showdetail=&amp;Stock_Ticket=ST1",
    "yard_locationsview.php?Stock_Ticket=ST1&amp;showdetail=",
  );
  expect(() =>
    parsePullsavewaPage(
      pullsavewaTestPage("all", [pullsavewaTestRow(1), reordered]),
      pullsavewaTestMead,
      "all",
    ),
  ).toThrow("duplicate");
});

test("Pull & Save preserves the published photo reference bound to the native donor link", () => {
  const photo =
    "https://newautopart.net/includes/pullandsave/mead_photos/311129_01.jpg";
  const page = parsePullsavewaPage(
    pullsavewaTestPage("all", [pullsavewaTestRow(1, { photo })]),
    pullsavewaTestMead,
    "all",
  );
  expect(page.records[0]?.nativeImageUrl).toBe(photo);
});

test("Pull & Save nulls invalid optional entities without weakening native ownership", () => {
  const page = pullsavewaTestPage("all", [
    pullsavewaTestRow(1, {
      stock: "&notvalid;",
      row: "&notvalid;",
      date: "&notvalid;",
      photo: "&notvalid;",
    }),
  ]);
  const record = parsePullsavewaPage(page, pullsavewaTestMead, "all")
    .records[0];
  expect(record).toMatchObject({
    stock: "",
    row: "",
    date: "",
    nativeImageUrl: null,
  });
});

test("Pull & Save requires the optional image to be inside its stock-bound anchor", () => {
  const photo =
    "https://newautopart.net/includes/pullandsave/mead_photos/311129_01.jpg";
  const row = pullsavewaTestRow(1, { photo });
  for (const changed of [
    row.replace(/(<img[^>]*>)(<\/a>)/, "$2$1"),
    row.replace(/(<a\b[^>]*>)(<img[^>]*>)/, "$2$1"),
  ]) {
    const parsed = parsePullsavewaPage(
      pullsavewaTestPage("all", [changed]),
      pullsavewaTestMead,
      "all",
    );
    expect(parsed.records[0]?.nativeImageUrl).toBeNull();
  }
});
