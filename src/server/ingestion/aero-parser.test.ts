import { expect, test } from "bun:test";
import { parseAeroCatalog, parseAeroRecent } from "./aero-parser";
import {
  aeroTestPage,
  aeroTestRecord,
  aeroTestRow,
} from "./aero-test-fixtures";

const page = aeroTestPage(aeroTestRow());
test("Aero parses the complete native table with implicitly closed photo cells", () => {
  expect(parseAeroCatalog(page)).toEqual([aeroTestRecord]);
  expect(
    parseAeroRecent(aeroTestPage(aeroTestRow(aeroTestRecord, true), true)),
  ).toEqual([
    {
      year: "2004",
      make: "NISSAN",
      model: "TITAN",
      engine: aeroTestRecord.engine,
      color: "GRAY",
      stock: "STK004808",
      row: "19",
    },
  ]);
});

test.each([
  page.replace("</html>", ""),
  page.replace("</tbody>", ""),
  page.replace("</tr></tbody>", "</tbody>"),
  page.replace('<td data-label="VIN">', '<td data-label="Color">'),
  page.replace("<th>VIN</th>", "<th>Serial</th>"),
  page.replace("<tbody>", "<tbody><td>stray</td>"),
  page.replace("<tbody>", "<tbody><tr>"),
  page.replace(
    "</table>",
    "</table><table id='vehicles'><thead></thead><tbody></tbody></table>",
  ),
  page.replace("bInfo: false", 'bInfo: false, serverSide: true, ajax: "/page"'),
  page.replace(".dataTable", ".unknown"),
  page.replace(
    "</script>",
    '</script><script>$("#vehicles").DataTable({serverSide:true});</script>',
  ),
  aeroTestPage(""),
])(
  "Aero fails closed on incomplete or changed catalog contracts (%#)",
  (html) => {
    expect(() => parseAeroCatalog(html)).toThrow();
  },
);

test("Aero decodes native text without mistaking script or comment rows for donors", () => {
  const html = page
    .replace("NISSAN", "NISS&#65;N")
    .replace(
      "<tbody>",
      '<tbody><!-- <tr><td>fake</td></tr> --><script>"<tr></tr>"</script>',
    );
  expect(parseAeroCatalog(html)[0]?.make).toBe("NISSAN");
});
