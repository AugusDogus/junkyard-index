import { expect, test } from "bun:test";
import { parseRmmdtpPage } from "./rmmdtp-parser";
import { rmmdtpFixture } from "./rmmdtp-test-fixtures";

test("RMMDTP parses the full unfiltered graph and retains labeled native claims", () => {
  const pages = Array.from({ length: 5 }, (_, index) =>
    parseRmmdtpPage(rmmdtpFixture("opening", index + 1), index + 1),
  );
  expect(pages.flatMap((page) => page.records)).toHaveLength(106);
  expect(pages[0]?.salvageTotal).toBe(104);
  expect(pages[0]?.completeTotal).toBe(2);
  expect(pages[4]?.records).toHaveLength(6);
  expect(pages[4]?.nextUrl).toBeNull();
  expect(pages[0]?.records[0]?.fields["Engine Model"]).toBe("ISB 200");
  const other = pages
    .flatMap((page) => page.records)
    .find((row) => row.id === "145725");
  expect(other?.fields.Description).toBe("2015 KIA SORENTO");
  expect(other?.fields["Truck Make"]).toBe("Other");
  for (const [index, page] of pages.entries())
    expect(
      parseRmmdtpPage(rmmdtpFixture("closing", index + 1), index + 1).hash,
    ).toBe(page.hash);
});

test("RMMDTP refuses incomplete, filtered, foreign and contradictory native controls", () => {
  const body = rmmdtpFixture("opening", 1);
  const mutations = [
    body.slice(0, -50),
    body.replace(
      "<div class='filter-list'></div>",
      "<div class='filter-list'>Truck Make: Ford</div>",
    ),
    body.replace("1-25 of 106", "1-24 of 106"),
    body.replace(
      "https://rmmdtp.com/trucks/?page_number=2",
      "https://foreign.example/trucks/?page_number=2",
    ),
    body.replace(
      " /truck-description/?truck=196423",
      " /truck-description/?truck=196424",
    ),
    body.replace(
      " /truck-description/?truck=196423",
      " https://foreign.example/truck-description/?truck=196423",
    ),
    body.replace("<h6> Truck Model :</h6>", "<h6> Truck Make :</h6>"),
    body.replace("1-25 of 106", "1-25 of 107"),
    body.replace("2715 North Mule Ranch Circle", "3700 North 2000 West"),
  ];
  for (const mutation of mutations)
    expect(() => parseRmmdtpPage(mutation, 1)).toThrow();
  expect(() => parseRmmdtpPage(body, 2)).toThrow();
  expect(() =>
    parseRmmdtpPage(body + "x".repeat(2 * 1024 * 1024), 1),
  ).toThrow();
});
