export const idipullTestMap =
  "https://www.google.com/maps/place/3015+N+15th+E,+Idaho+Falls,+ID+83401/@43.5230819,-112.0083947,17z/data=!3m1!4b1!4m5!3m4!1s0x53545c3122d97643:0xc45fa1630189e98c!8m2!3d43.523078!4d-112.006206";
const identity = `<a href="${idipullTestMap}">3015 N 15th E Idaho Falls</a>
<a href="tel:2085244461">(208) 524-4461</a>
<p>3015 N 15th E Idaho Falls, ID 83401</p>`;
export const idipullTestHome = `<html><body>${identity}
<p>Search our in-stock vehicles to ensure you find the part you need. Updated daily.</p>
<p>Bring your own tools and pull your own parts.</p>
<a href="https://ifipull.com/inventory/">Search Inventory</a></body></html>`;
export const idipullTestRecord = {
  year: "2008",
  make: "CHEVROLET",
  model: "EXPRESS",
  reference: "",
  vin: "1GBJG31K581198313",
  color: "GREEN",
  stockNumber: "STK015489",
  row: "53",
  arrivalDate: "11/10/26",
};
const labels = [
  "Year",
  "Make",
  "Model",
  "Reference",
  "VIN",
  "Color",
  "StockNumber",
  "Row",
  "Arrived",
];
export function idipullTestRow(record = idipullTestRecord): string {
  return (
    "<tr>" +
    Object.values(record)
      .map((value, index) => `<td data-label="${labels[index]}">${value}</td>`)
      .join("") +
    "</tr>"
  );
}
export function idipullTestPage(rows = idipullTestRow()): string {
  return `<html><body>${identity}<h1>Inventory</h1>Updated: 11/11/26<br>
<script>$(document).ready(function() { $("#vehicles").dataTable({
bLengthChange: true, "iDisplayLength": 10, bInfo: false, responsive: true,
"bAutoWidth": false, "pagingType": "full_numbers", "order": [[6, "desc"]] }); });</script>
<table id="vehicles"><thead><tr>${["Year", "Make", "Model", "Reference", "VIN", "Color", "Stock #", "Vehicle Row", "Arrival Date"].map((value) => `<th>${value}</th>`).join("")}</tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
}
