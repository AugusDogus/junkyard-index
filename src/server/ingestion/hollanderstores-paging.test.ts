import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  hollanderstoresExpected as expected,
  hollanderstoresFixture as body,
} from "./hollanderstores-test-fixtures";
import { parseHollanderstoresRoster } from "./hollanderstores-parser";
import {
  HOLLANDERSTORES_YARDS,
  type HollanderstoresYard,
} from "./hollanderstores-yard-metadata";

const raw = gunzipSync(
  readFileSync(
    `${import.meta.dir}/hollanderstores-test-fixtures/expansion/aaaparts-page-1.html.gz`,
  ),
).toString();
const aaa: HollanderstoresYard = {
  ...HOLLANDERSTORES_YARDS[0],
  code: "aaaparts",
  tenant: "69",
  logo: "aaa auto parts",
  websiteUrl: "https://aaaparts.hollanderstores.com/",
};

test("native AAA list view has 20 rows, no make column and a checked next page", () => {
  const page = parseHollanderstoresRoster(raw, aaa);
  expect(page.total).toBe(17884);
  expect(page.rows).toHaveLength(20);
  expect(page.nextPage).toBe(2);
  expect(page.rows[0]).toEqual({
    displayYear: "'94",
    make: null,
    model: "CUT-SUPRE",
    stock: "PBS",
    vin: "1G3WH15M1RD340025",
    url: "https://aaaparts.hollanderstores.com/VehicleDealerShowParts/69/1119522",
  });
  expect(page.rows.every((row) => row.make === null)).toBe(true);
  const second = parseHollanderstoresRoster(body("aaaparts-page-2"), aaa, 2);
  // The independently captured second page already reports one fewer donor.
  // Production traversal rejects this drift instead of combining the two totals.
  expect(second.total).toBe(17883);
  expect(second.nextPage).toBe(3);
  expect(second.rows).toHaveLength(20);
  expect(
    second.rows.some((row) => page.rows.some((first) => first.url === row.url)),
  ).toBe(false);
});

test("paged grammar rejects wrong positions, next links, row loss, foreign destinations and truncation", () => {
  expect(() => parseHollanderstoresRoster(raw, aaa, 2)).toThrow();
  for (const changed of [
    raw.replaceAll("?page=2", "?page=900"),
    raw.replace(/<tr class="rowPadding">[\s\S]*?<\/tr>/, ""),
    raw.replace(
      "/VehicleDealerShowParts/69/1119522",
      "/VehicleDealerShowParts/4573/1119522",
    ),
    raw.slice(0, -100),
    raw.replace("Showing 17884", "Showing 25001"),
  ])
    expect(() => parseHollanderstoresRoster(changed, aaa)).toThrow();
});

test("list pages resume durably and release inventory only after the closing roster", async () => {
  const { spyOn } = await import("bun:test");
  const { Effect } = await import("effect");
  const metadata = await import("./hollanderstores-yard-metadata");
  const { HollanderstoresCursor } = await import("./hollanderstores-cursor");
  const { streamHollanderstoresInventory } =
    await import("./hollanderstores-connector");
  const { parseHollanderstoresPage } = await import("./hollanderstores-parser");
  const { hollanderstoresSeed } = await import("./hollanderstores-client");
  const leblanc = HOLLANDERSTORES_YARDS[0];
  const roster = parseHollanderstoresPage(body(leblanc.code), 0);
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;");
  const list = (page: number) => {
    const rows = roster.rows
      .slice((page - 1) * 20, page * 20)
      .map(
        (row) =>
          `<tr><td>${row.displayYear}</td><td>${escape(row.model)}</td><td>${escape(row.stock)}</td><td></td><td></td><td>${row.vin}</td><td>1</td><td><a href="${new URL(row.url).pathname}">View Parts</a></td></tr>`,
      )
      .join("");
    const last = Math.ceil(roster.total / 20);
    return raw
      .replace("aaa auto parts</a>", `${leblanc.logo}</a>`)
      .replace("Showing 17884", `Showing ${roster.total}`)
      .replace(/<tbody>[\s\S]*?<\/tbody>/, `<tbody>${rows}</tbody>`)
      .replace(
        /<tfoot>[\s\S]*?<\/tfoot>/,
        `<tfoot><tr><td>${page}${page < last ? ` <a href="/VehicleDealerSearch?page=${page + 1}">&gt;</a>` : ""}</td></tr></tfoot>`,
      );
  };
  // Exercise the native 20-row grammar with a smaller already-audited yard.
  const mode = spyOn(metadata, "hollanderstoresUsesPaging").mockImplementation(
    (yard) => yard.code === leblanc.code,
  );
  const count = spyOn(metadata, "hollanderstoresPageCount").mockImplementation(
    (yard, total) => (yard.code === leblanc.code ? Math.ceil(total / 20) : 1),
  );
  let emitted = 0,
    reads = 0;
  try {
    let cursor = HollanderstoresCursor.initial();
    let persistedAt = 0;
    do {
      const result = await Effect.runPromise(
        streamHollanderstoresInventory({
          startCursor: cursor,
          maxPages: cursor.requests === 0 ? 1 : 8,
          readPage: (yard, page) =>
            Effect.sync(() => {
              reads++;
              return yard.code === leblanc.code ? list(page) : body(yard.code);
            }),
          decodeBatch: (vins) =>
            Effect.succeed(
              Object.fromEntries(
                vins.map((vin) => [vin, hollanderstoresSeed[vin] ?? null]),
              ),
            ),
          onBatch: (vehicles) =>
            Effect.sync(() => {
              emitted++;
              expect(vehicles).toHaveLength(expected.count);
            }),
        }),
      );
      const previousPhase = cursor.phase;
      cursor = result.cursor;
      // Retain the partial-list resume and every phase transition. The full
      // durable replay separately persists every chunk of the census.
      if (
        cursor.requests === 1 ||
        cursor.phase !== previousPhase ||
        cursor.requests - persistedAt >= 96
      ) {
        cursor = HollanderstoresCursor.fromWire(
          HollanderstoresCursor.serialize(cursor),
        );
        persistedAt = cursor.requests;
      }
      if (cursor.requests === 1) {
        expect(cursor.pages).toHaveLength(0);
        expect(cursor.pending?.rows).toHaveLength(20);
        const drift = await Effect.runPromiseExit(
          streamHollanderstoresInventory({
            startCursor: cursor,
            maxPages: 1,
            readPage: (_yard, page) =>
              Effect.succeed(
                list(page).replace(
                  `Showing ${roster.total}`,
                  `Showing ${roster.total + 1}`,
                ),
              ),
            decodeBatch: () =>
              Effect.die("No decoding during a partial roster"),
            onBatch: () => Effect.die("Drift cannot release inventory"),
          }),
        );
        expect(drift._tag).toBe("Failure");
        const pending = cursor.pending;
        if (!pending) throw new Error("Expected a partial list roster");
        const { checksum, ...state } = cursor;
        expect(checksum).toMatch(/^[0-9a-f]{8}$/);
        expect(HollanderstoresCursor.checkpoint(state)).toEqual(cursor);
        expect(() =>
          HollanderstoresCursor.checkpoint({
            ...state,
            pending: { ...pending, total: 20 },
          }),
        ).toThrow();
        expect(() =>
          HollanderstoresCursor.checkpoint({
            ...state,
            pending: {
              ...pending,
              rows: [...pending.rows.slice(0, -1), pending.rows[0]],
            },
          }),
        ).toThrow();
      }
      if (result.status === "paused") expect(emitted).toBe(0);
    } while (cursor.phase !== "complete");
    expect(reads).toBe(
      2 * (Math.ceil(roster.total / 20) + HOLLANDERSTORES_YARDS.length - 1),
    );
    expect(emitted).toBe(1);
  } finally {
    mode.mockRestore();
    count.mockRestore();
  }
}, 600_000);
