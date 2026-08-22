import { describe, expect, test } from "bun:test";
import {
  normalizeCrushArrivalDate,
  parseCrushInventoryHtml,
  type CrushMvcParseContext,
} from "./crush-mvc-transform";

const CONTEXT: CrushMvcParseContext = {
  sourceUrl: "https://example.com/Home/Inventory",
  yardId: null,
  yardName: "Test Yard",
};

function fixtureUrl(fileName: string): URL {
  return new URL(`./fixtures/${fileName}`, import.meta.url);
}

function buildTable(headerCells: string[], rows: string[][]): string {
  const header = headerCells.map((cell) => `<th>${cell}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table class="table table-fluid"><tr>${header}</tr>${body}</table>`;
}

describe("normalizeCrushArrivalDate", () => {
  test("normalizes MM/DD/YYYY to ISO", () => {
    expect(normalizeCrushArrivalDate("04/11/2026")).toBe("2026-04-11");
    expect(normalizeCrushArrivalDate("1/2/2026")).toBe("2026-01-02");
  });

  test("returns null for invalid or unexpected values", () => {
    expect(normalizeCrushArrivalDate("13/01/2026")).toBe(null);
    expect(normalizeCrushArrivalDate("2026-04-11")).toBe(null);
    expect(normalizeCrushArrivalDate("")).toBe(null);
  });
});

describe("parseCrushInventoryHtml", () => {
  test("parses the canonical YEAR|MAKE|MODEL|COLOR|REFERENCE|ROW|ARRIVAL DATE layout", async () => {
    const html = await Bun.file(
      fixtureUrl("crush-mvc-youngstown-upullit-inventory.html"),
    ).text();
    const listings = parseCrushInventoryHtml(html, CONTEXT);

    expect(listings.length).toBe(370);
    expect(listings[0]).toEqual({
      year: 1999,
      make: "FORD",
      model: "EXPLORER",
      color: "UNKNOWN",
      reference: null,
      row: "304",
      arrivalDate: "2026-04-11",
      yardId: null,
      yardName: "Test Yard",
      sourceUrl: CONTEXT.sourceUrl,
    });
  });

  test("tolerates the reduced YEAR|MAKE|MODEL|ROW layout without color or dates", async () => {
    const html = await Bun.file(
      fixtureUrl("crush-mvc-pickapart-jalopy-jungle-inventory.html"),
    ).text();
    const listings = parseCrushInventoryHtml(html, {
      sourceUrl: "https://inventory.pickapartjalopyjungle.com/",
      yardId: 1020,
      yardName: "Boise",
    });

    expect(listings.length).toBe(155);
    expect(listings[0]).toEqual({
      year: 2009,
      make: "FORD",
      model: "FUSION",
      color: null,
      reference: null,
      row: "63",
      arrivalDate: null,
      yardId: 1020,
      yardName: "Boise",
      sourceUrl: "https://inventory.pickapartjalopyjungle.com/",
    });
  });

  test("maps extra and reordered columns by header label", () => {
    const html = buildTable(
      ["LOCATION", "ROW", "MODEL", "YEAR", "PHOTO", "MAKE", "STOCK #"],
      [
        ["YARD A", "12", "CIVIC", "2015", "", "HONDA", "ABC123"],
        ["YARD A", "15", "ACCORD", "bogus-year", "", "HONDA", "DEF456"],
      ],
    );
    const listings = parseCrushInventoryHtml(html, CONTEXT);

    expect(listings.length).toBe(1);
    expect(listings[0]).toMatchObject({
      year: 2015,
      make: "HONDA",
      model: "CIVIC",
      reference: "ABC123",
      row: "12",
    });
  });

  test("rejects rows missing year, make, or model", () => {
    const html = buildTable(
      ["YEAR", "MAKE", "MODEL", "ROW"],
      [
        ["not-a-year", "FORD", "FOCUS", "10"],
        ["2010", "", "FOCUS", "11"],
        ["2011", "FORD", "", "12"],
        ["2012", "FORD", "FIESTA", "13"],
      ],
    );
    const listings = parseCrushInventoryHtml(html, CONTEXT);

    expect(listings.length).toBe(1);
    expect(listings[0]).toMatchObject({ year: 2012, model: "FIESTA" });
  });

  test("normalizes malformed arrival dates to null while keeping the listing", () => {
    const html = buildTable(
      ["YEAR", "MAKE", "MODEL", "ARRIVAL DATE"],
      [["2013", "FORD", "TAURUS", "yesterday"]],
    );
    const listings = parseCrushInventoryHtml(html, CONTEXT);

    expect(listings.length).toBe(1);
    expect(listings[0]?.arrivalDate).toBe(null);
  });

  test("decodes entities and strips markup inside cells", () => {
    const html = buildTable(
      ["YEAR", "MAKE", "MODEL", "COLOR"],
      [["2014", "<b>FORD</b>", "F&nbsp;150", "&amp;UNKNOWN"]],
    );
    const listings = parseCrushInventoryHtml(html, CONTEXT);

    expect(listings[0]).toMatchObject({
      make: "FORD",
      model: "F 150",
      color: "&UNKNOWN",
    });
  });

  test("returns an empty array when no results table header exists", () => {
    expect(
      parseCrushInventoryHtml(
        "<html><body>No inventory</body></html>",
        CONTEXT,
      ),
    ).toEqual([]);
  });
});
