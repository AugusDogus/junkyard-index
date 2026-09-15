import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  parsePartsGaloreCatalog,
  PARTSGALORE_MAX_CATALOG_RECORDS,
  PARTSGALORE_MAX_HTML_LENGTH,
} from "./partsgalore-parser";

const fixture = await Bun.file(
  new URL("./fixtures/partsgalore-catalog.html", import.meta.url),
).text();
const parse = (html: string) =>
  Effect.runPromise(parsePartsGaloreCatalog(html));

describe("Parts Galore table contract", () => {
  test("ignores commented headers and script VINs, preserving legacy identifiers and entities", async () => {
    const records = await parse(
      `<script>const decoy = '<table id="alldata"><tr><td>VIN123</td></tr></table>';</script>${fixture}<table><tr><td>OTHER VIN</td></tr></table>`,
    );
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      vin: "3N69R9M338069",
      year: "1979",
      row: "101",
    });
    expect(records[1]).toMatchObject({
      model: "Town & Country",
      yardDate: "2026-08-18",
      stockNumber: "",
    });
  });
  test("uses reordered th headers with optional/unknown columns and inline markup", async () => {
    const records =
      await parse(`<TABLE class="inventory" id='alldata'><THEAD><TR>
      <TH>Stock #</TH><TH>VIN</TH><TH>Model</TH><TH>Make</TH><TH>Year</TH><TH>Unused</TH>
      </TR></THEAD><TBODY><TR><TD> PG-7 </TD><TD title="VIN > text"> 2C4RC1CG<span>6ER328677</span> </TD>
      <TD><span title="not > text">Town&nbsp;&amp;&#x20;Country</span></TD><TD>Chrysler</TD><TD>2014</TD><TD>ignored</TD>
      </TR></TBODY></TABLE>`);
    expect(records).toEqual([
      {
        vin: "2C4RC1CG6ER328677",
        year: "2014",
        make: "Chrysler",
        model: "Town & Country",
        stockNumber: "PG-7",
        row: "",
        color: "",
        yardDate: "",
      },
    ]);
  });
  test("keeps a mismatched row in the raw count as a rejected record", async () => {
    const records = await parse(
      fixture.replace("</tbody>", "<tr><td>unusable</td></tr></tbody>"),
    );
    expect(records).toHaveLength(3);
    expect(records[2]).toBeNull();
  });
  test.each([
    ["missing table", "<html>Access denied</html>"],
    [
      "empty table",
      fixture.replace(/<tbody>[\s\S]*?<\/tbody>/, "<tbody></tbody>"),
    ],
    ["duplicate table", fixture + fixture],
    ["truncated table", fixture.replace("</table>", "")],
    ["truncated body", fixture.replace("</tbody>", "")],
    ["unclosed row", fixture.replace("</tr>", "")],
    ["unclosed cell", fixture.replace("<td>1979</td>", "<td>1979")],
    ["duplicate headers", fixture.replace("<td>Model</td>", "<td>VIN</td>")],
    [
      "missing VIN header",
      fixture.replace("<td>VIN</td>", "<td>Identifier</td>"),
    ],
    ["spanning cells", fixture.replace("<td>1979", '<td colspan="2">1979')],
    [
      "unsupported entity",
      fixture.replace("Eighty Eight</td>", "&unknown;</td>"),
    ],
    [
      "invalid numeric entity",
      fixture.replace("Eighty Eight</td>", "&#x110000;</td>"),
    ],
    ["unclosed script", `<script>${fixture}`],
    ["unclosed comment", `<!--${fixture}`],
    [
      "orphan row",
      fixture.replace("</tbody>", "</tbody><tr><td>lost</td></tr>"),
    ],
    ["orphan cell", fixture.replace("</tbody>", "<td>lost</td></tbody>")],
  ])("fails closed for %s", async (_name, html) => {
    const result = await Effect.runPromise(
      Effect.either(parsePartsGaloreCatalog(html)),
    );
    expect(result._tag).toBe("Left");
  });
  test("rejects oversized catalogs instead of silently slicing", async () => {
    const row =
      "<tr><td>1979</td><td>Oldsmobile</td><td>88</td><td>3N69R9M338069</td><td></td><td></td><td></td></tr>";
    const large = fixture.replace(
      /<tbody>[\s\S]*?<\/tbody>/,
      `<tbody>${row.repeat(PARTSGALORE_MAX_CATALOG_RECORDS + 1)}</tbody>`,
    );
    await expect(parse(large)).rejects.toThrow("10001 rows");
    await expect(
      parse(" ".repeat(PARTSGALORE_MAX_HTML_LENGTH + 1)),
    ).rejects.toThrow("bound");
  });
});
