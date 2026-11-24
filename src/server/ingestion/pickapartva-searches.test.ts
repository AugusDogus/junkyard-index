import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { z } from "zod";
import { parsePickapartvaSearch } from "./pickapartva-parser";

// The live November 24, 2026 searches for Set Date 2026-11-21. See
// pickapartva-test-fixtures/README.md.
const [all = "", stafford = ""] = z
  .array(z.object({ url: z.string(), body: z.string() }).strict())
  .length(2)
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL(
            "./pickapartva-test-fixtures/searches-2026-11-21.json.br",
            import.meta.url,
          ),
        ),
      ).toString(),
    ),
  )
  .map((response) => response.body);

test("Pick-A-Part VA reads the live empty Stafford search for 2026-11-21 as no donors", () => {
  expect(parsePickapartvaSearch(stafford, "2026-11-21", "UU81")).toMatchObject({
    status: "complete",
    page: { id: "UU81", make: "ANY", records: [] },
  });
  // The empty answer still names its yard and make, so it never stands in
  // for another yard, a make or every yard.
  expect(() => parsePickapartvaSearch(stafford, "2026-11-21", "TT87")).toThrow(
    "narrowed physical scope",
  );
  expect(() =>
    parsePickapartvaSearch(stafford, "2026-11-21", "UU81", "FORD"),
  ).toThrow("does not prove its selected make FORD and yard UU81");
  expect(() => parsePickapartvaSearch(stafford, "2026-11-21")).toThrow(
    "narrowed physical scope",
  );
});

test("Pick-A-Part VA keeps the donors a capped live search lists", () => {
  const result = parsePickapartvaSearch(all, "2026-11-21");
  if (result.status !== "capped") throw new Error("Expected a capped search");
  expect(result.page.records).toHaveLength(500);
  expect(
    result.page.records.every(
      (record) => record.setDate === "2026-11-21" && record.yardCode === "TT87",
    ),
  ).toBe(true);
  expect(result.makes).toHaveLength(62);
  // Its donors are verified like a complete search's.
  expect(() =>
    parsePickapartvaSearch(
      all.replace(
        "<b>Set Date: </b> 2026-11-21<br/>",
        "<b>Set Date: </b> 2026-11-20<br/>",
      ),
      "2026-11-21",
    ),
  ).toThrow("set on another date");
});
