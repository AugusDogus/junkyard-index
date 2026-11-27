import { describe, expect, test } from "bun:test";
import { DORMANT_YARD_DAYS, DormantYard } from "./dormant-yard";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-11-27T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now - days * DAY_MS).toISOString();

const yard = (source: string, code: string, name: string, city = "Tulsa") => ({
  source,
  code,
  name,
  city,
  state: "OK",
});

describe("DormantYard.pages", () => {
  test("keeps a page for DORMANT_YARD_DAYS after a yard stops showing vehicles", () => {
    const pages = DormantYard.pages(
      [yard("row52", "1", "Listed Yard")],
      [
        {
          ...yard("pyp", "1", "Blocked Yard"),
          dormant: { kind: "unconfirmed", since: daysAgo(10) },
        },
        {
          ...yard("pyp", "2", "Emptied Yard"),
          dormant: { kind: "emptied", since: daysAgo(DORMANT_YARD_DAYS) },
        },
        {
          ...yard("pyp", "3", "Long Gone Yard"),
          dormant: { kind: "emptied", since: daysAgo(DORMANT_YARD_DAYS + 1) },
        },
      ],
      now,
    );
    expect(pages.map((page) => [page.code, page.path.href])).toEqual([
      ["1", "/junkyards/oklahoma/blocked-yard-tulsa"],
      ["2", "/junkyards/oklahoma/emptied-yard-tulsa"],
    ]);
  });

  test("gives no page to a yard a listed yard succeeded or that is listed itself", () => {
    const listed = [
      yard("hollander", "9", "Paul's Auto Yard"),
      yard("row52", "1", "Same Yard"),
    ];
    const pages = DormantYard.pages(
      listed,
      [
        {
          ...yard("autorecycler", "9", "Paul's Auto Yard"),
          dormant: { kind: "emptied", since: daysAgo(1) },
        },
        {
          ...yard("row52", "1", "Same Yard"),
          dormant: { kind: "emptied", since: daysAgo(1) },
        },
      ],
      now,
    );
    expect(pages).toEqual([]);
  });

  test("tells dormant yards that share a name apart without moving listed paths", () => {
    const pages = DormantYard.pages(
      [yard("row52", "1", "Listed Yard")],
      ["a", "b"].map((code) => ({
        ...yard("pyp", code, "Twin Yard"),
        dormant: { kind: "emptied" as const, since: daysAgo(1) },
      })),
      now,
    );
    expect(pages).toHaveLength(2);
    const [first, second] = pages;
    expect(first?.path.href).toMatch(
      /^\/junkyards\/oklahoma\/twin-yard-tulsa-\w{6}$/,
    );
    expect(second?.path.href).toMatch(
      /^\/junkyards\/oklahoma\/twin-yard-tulsa-\w{6}$/,
    );
    expect(first?.path.href).not.toBe(second?.path.href);
  });
});
