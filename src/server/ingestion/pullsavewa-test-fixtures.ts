import { PULLSAVEWA_DISCLAIMER } from "./pullsavewa-parser";
import {
  PULLSAVEWA_YARDS,
  type PullsavewaYard,
} from "./pullsavewa-yard-metadata";

export function pullsavewaTestHome(yard: PullsavewaYard): string {
  const address =
    yard.code === "mead"
      ? "11125 N. Market St.- MEAD - 99021"
      : "10414 E. KNOX - SPOKANE - 99206";
  return `<html><body>Pull &amp; Save is a completely self-service automotive used parts business located in ${yard.code === "mead" ? "Mead" : "Spokane"}, WA. Vehicles to pull parts from and new vehicles every week. ${address} ${yard.phone}<a href="${yard.inventoryUrl}">Inventory</a></body></html>`;
}

export function pullsavewaTestRow(
  id: number,
  overrides: Partial<{
    stock: string;
    row: string;
    date: string;
    vin: string;
    year: string;
    make: string;
    model: string;
    photo: string;
  }> = {},
): string {
  const record = {
    stock: `ST${id}`,
    row: "A12",
    date: "11/11/2026",
    vin: `2CNALBEW8A${String(id).padStart(7, "0")}`,
    year: "2010",
    make: "CHEVROLET",
    model: "EQUINOX",
    photo: "",
    ...overrides,
  };
  const link = `<a href="yard_locationsview.php?showdetail=&amp;Stock_Ticket=ST${id}">View</a>`;
  const cells = [
    "view",
    "Image",
    "Stock_Ticket",
    "Row",
    "Date_Set",
    "Vin",
    "Year",
    "Make",
    "Model",
  ];
  const values = [
    link,
    record.photo
      ? link.replace(
          "View</a>",
          `<img src="data:image/png;base64,placeholder" data-src="${record.photo}"></a>`,
        )
      : link,
    record.stock,
    record.row,
    record.date,
    record.vin,
    record.year,
    record.make,
    record.model,
  ];
  return `<tr data-rowindex="${id}" id="r${id}_yard_locations" data-rowtype="1">${cells.map((cell, index) => `<td data-name="${cell}"><span>${values[index]}</span></td>`).join("")}</tr>`;
}

export function pullsavewaTestPage(
  kind: "first" | "all" | "last",
  records: readonly string[] = Array.from({ length: 21 }, (_, i) =>
    pullsavewaTestRow(i + 1),
  ),
): string {
  const total = records.length;
  const start = kind === "last" ? Math.floor((total - 1) / 20) * 20 + 1 : 1;
  const rows = kind === "all" ? records : records.slice(start - 1, start + 19);
  const headers = [
    "view",
    "Image",
    "Stock_Ticket",
    "Row",
    "Date_Set",
    "Vin",
    "Year",
    "Make",
    "Model",
  ];
  const labels = [
    "&nbsp;",
    "Image",
    "Stock Ticket",
    "Row",
    "Date Set",
    "Vin",
    "Year",
    "Make",
    "Model",
  ];
  const pager = `<form name="ew-pager-form" action="yard_locationslist.php">${kind === "all" ? "" : `<span>Records ${start} to ${Math.min(start + 19, total)} of ${total}</span><select name="recperpage" onchange="this.form.submit();"><option value="20" selected>20</option><option value="ALL">All</option></select>${kind === "first" && total > 20 ? `<a title="Next" href="yard_locationslist.php?start=21">Next</a><a title="Last" href="yard_locationslist.php?start=${Math.floor((total - 1) / 20) * 20 + 1}">Last</a>` : ""}`}</form>`;
  return `<html><body><script>fyard_locationslistsrch.filterList = null;</script><form name="fyard_locationslistsrch" action="yard_locationslist.php"><input name="cmd" value="search"><input name="t" value="yard_locations"><input name="psearch" value=""><input name="psearchtype" value=""></form>${PULLSAVEWA_DISCLAIMER.replaceAll("&", "&amp;")}${pager}<table id="tbl_yard_locationslist"><thead><tr>${headers.map((name, i) => `<th data-name="${name}">${labels[i]}</th>`).join("")}</tr></thead><tbody>${rows.map((row, i) => row.replace(/data-rowindex="\d+"/, `data-rowindex="${i + 1}"`).replace(/id="r\d+_yard_locations"/, `id="r${i + 1}_yard_locations"`)).join("")}</tbody></table>${pager}</body></html>`;
}

export const pullsavewaTestMead = PULLSAVEWA_YARDS[0];
