import { OEM_ARRIVALS, OEM_MAKES, OEM_ORIGIN } from "./oem-html";

// Native IIS excerpts captured November 15, 2026. Presentation and account
// scripts are omitted. The arrival counter's missing </span> is preserved.
export const oemFord = {
  url: OEM_ORIGIN + "/parts/FORD",
  label: "FORD",
  count: 483,
};
export const oemF150 = {
  url: OEM_ORIGIN + "/parts/FORD/FORD_F150_PICKUP/",
  label: "FORD F150 PICKUP",
  count: 86,
};
export function oemFixtureDocument(content: string, canonical?: string) {
  return `<html><head><title>OEM Auto Recyclers</title>${
    canonical ? `<link rel="canonical" href="${canonical}">` : ""
  }</head><body>
    <h1>OEM Auto Recyclers</h1>${content}
    <footer>481 Township Road 27 Bluffton, OH 45817</footer>
    <script>var urgid = 'OH40';</script></body></html>`;
}
export const oemMakeFixture =
  oemFixtureDocument(`<div class="iisMakesMenu"><ul class="menu">
  <li><a href="https://oemautorecyclers.com/parts/FORD">FORD <span class="badge badge-light">483</span></a></li>
  </ul></div>`);
export const oemModelFixture =
  oemFixtureDocument(`<div id="menumodellist"><ul class="menu">
  <li><a href="//oemautorecyclers.com/parts/FORD/FORD_F150_PICKUP/">FORD F150 PICKUP <span class="badge badge-light">86</span></a></li>
  </ul></div>`);
export const oemDonorExcerpt = `<div id="10563" class="card card-price">
  <div class="card-img"><a href="//oemautorecyclers.com/parts/FORD/FORD_F150_PICKUP/10563/2024">
  <img class="lazyload img-responsive" data-src="https://da8h1v3w8q6n5.cloudfront.net/oh40/images/10563/10563_0.jpg"
  src="https://oemautorecyclers.com/wp-content/plugins/iis-pro-v2/images/no-image-min.webp"></a></div>
  <div class="card-body"><div class="car-details">
  <b>Stock:</b> 10563<br><b>Year:</b> 2024<br><b>Make/Model :</b> FORD F150 PICKUP<br>
  <b>Vin :</b> 1FTMF1KP0RKE76038<br><b>Miles :</b> 23000<br></div>
  <a class="buy-now" href="//oemautorecyclers.com/parts/FORD/FORD_F150_PICKUP/10563/2024">See Parts <span></span></a>
  </div></div>`;
export const oemDonorFixture = oemFixtureDocument(oemDonorExcerpt);
export const oemArrivalFixture = oemFixtureDocument(
  `<div>Displaying <span id="filteredvehicleCount">1</span> of <span id="vehicleCount">1</div>${oemDonorExcerpt}`,
  OEM_ARRIVALS,
);
export const oemFixtureUrls = { arrivals: OEM_ARRIVALS, makes: OEM_MAKES };
