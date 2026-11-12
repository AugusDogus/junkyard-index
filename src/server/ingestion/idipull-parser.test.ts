import { expect, test } from "bun:test";
import { parseIdipullInventory, parseIdipullYard } from "./idipull-parser";
import {
  idipullTestHome,
  idipullTestPage,
  idipullTestRecord,
} from "./idipull-test-fixtures";

test("Idaho Falls parses the complete inline table without changing native fields", () => {
  expect(parseIdipullInventory(idipullTestPage())).toEqual([idipullTestRecord]);
  expect(parseIdipullYard(idipullTestHome)).toMatchObject({
    code: "idaho-falls",
    lat: 43.523078,
    lng: -112.006206,
  });
});

test.each([
  (html: string) => html.replace("</tbody>", ""),
  (html: string) =>
    html.replace('data-label="VIN"', 'data-label="StockNumber"'),
  (html: string) =>
    html.replace("bInfo: false", "serverSide: true, bInfo: false"),
  (html: string) => html.replace("</html>", ""),
  (html: string) => html.replace("!3d43.523078", "!3d43.523079"),
  (html: string) =>
    html.replace("</table>", '</table><a rel="next" href="?page=2">Next</a>'),
  (html: string) =>
    html.replace("</table>", '</table><form><input name="make"></form>'),
  (html: string) =>
    html.replace(
      "</table>",
      '</table><a href="/inventory/?offset=10">More</a>',
    ),
])(
  "Idaho Falls blocks incomplete structure, enumeration or ownership (%#)",
  (rewrite) => {
    expect(() => parseIdipullInventory(rewrite(idipullTestPage()))).toThrow();
  },
);
