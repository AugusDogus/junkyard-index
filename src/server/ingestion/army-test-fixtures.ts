import type { ArmyRecord } from "./army-parser";

export const armyTestRecord: ArmyRecord = {
  id: "835",
  make: "BMW",
  model: "X3",
  year: "2005",
  color: "BLUE",
  stock: "000000003739",
  vin: "WBXPA93465WD17483",
};

export function armyTestRow(record: ArmyRecord = armyTestRecord): string {
  return `<tr><td>
    <button class="vehicleModalButton" data-id="${record.id}" data-bs-target="#vehicleModal${record.id}">View</button>
    <div class="modal fade" id="vehicleModal${record.id}"><div class="modal-dialog"><div class="modal-content">
      <div class="modal-header"><h1>${record.make} ${record.model}</h1></div>
      <div class="modal-body"><div class="vehicleDetails"><div class="vehicleDetailItem">
        <div class="mb-2"><span class="fw-bold">Stock Number: </span>${record.stock}</div>
        <div class="mb-2"><span class="fw-bold">VIN: </span>${record.vin}</div>
      </div></div><div id="vehicleImages${record.id}" class="vehicleImages"></div></div>
    </div></div></div>
    </td><td>${record.make}</td><td>${record.model}</td><td>${record.year}</td><td>${record.color}</td></tr>`;
}

export function armyTestPage(rows = armyTestRow()): string {
  return `<html><head><link rel="canonical" href="https://armysauto.com/self-service-inventory/"></head><body>
    <h1>Self-Service Yard</h1><p>Army's is the largest and most up to date self service parts yard in the area.</p>
    <form action="">
      <select id="vehicle-make" name="vehicle-make"><option selected>Choose...</option><option value="5">BMW</option></select>
      <select id="vehicle-model" name="vehicle-model"><option selected>Choose...</option></select>
      <select id="vehicle-start-year" name="vehicle-start-year"><option selected>Choose...</option><option value="1960" selected>1960</option><option value="2026">2026</option></select>
      <select id="vehicle-end-year" name="vehicle-end-year"><option selected>Choose...</option><option value="1960">1960</option><option value="2026" selected>2026</option></select>
      <button name="submit" type="submit">Search</button>
    </form>
    <table data-pagination="false" data-search="true" data-show-toggle="false" data-toolbar=".toolbar" data-use-row-attr-func="true" data-reorderable-rows="false" class="table bootstrap-tables">
      <thead><tr><th>Images</th><th>Make</th><th>Model</th><th>Year</th><th>Color</th></tr></thead><tbody>${rows}</tbody>
    </table>
    <footer>Army&#8217;s Auto Wrecking 1510 St. John’s Rd. Lima, OH 45804 Parts: 567.371.1244 Towing: 419.225.1896 &copy; 2026</footer>
    <script src="https://armysauto.com/wp-content/plugins/yswp/assets/yswp.js?ver=0.60"></script>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap-table@1.24.1/dist/bootstrap-table.min.js"></script>
  </body></html>`;
}
