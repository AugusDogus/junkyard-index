import {
  CITYMOTORS_CATALOG,
  CITYMOTORS_ORIGIN,
} from "./citymotors-yard-metadata";

export const citymotorsFixtureOwner = `<footer>City Motors Chicago 2150 West St River Grove IL 60171</footer>
<script type="application/ld+json">{"@type":"AutoPartsStore","name":"City Motors Parts","url":"https://citymotorsparts.com/","telephone":"+1-708-395-5602","address":{"streetAddress":"2150 West St","addressLocality":"River Grove","addressRegion":"IL","postalCode":"60171"},"geo":{"latitude":"41.9274","longitude":"-87.8398"}}</script>`;
export const citymotorsFixturePost = {
  url: CITYMOTORS_ORIGIN + "/cars/2020-bmw-x7-3/",
  title: "2020 BMW X7",
  imageUrl:
    CITYMOTORS_ORIGIN + "/wp-content/uploads/2026/11/IMG_9541-scaled.jpg",
};
export function citymotorsFixtureCatalog(
  posts = [citymotorsFixturePost],
  page = 1,
  lastPage = 1,
) {
  const pageUrl = (number: number) =>
    CITYMOTORS_CATALOG + (number === 1 ? "" : "?page-number=" + number);
  return `<html><body><h1 class="slider-title">Cars</h1>${posts.map((post) => `<div class="product-item"><img data-full-src="${post.imageUrl}"><div class="product-item-content"><a class="product-item-title" href="${post.url}">${post.title}</a></div><a class="product-item-main-link" href="${post.url}"></a></div>`).join("")}<nav class="navigation pagination"><div class="nav-links"><span class="page-numbers current" aria-current="page">${page}</span>${lastPage > 1 ? `<a class="page-numbers" href="${pageUrl(lastPage)}">${lastPage}</a>` : ""}${page < lastPage ? `<a class="next page-numbers" href="${pageUrl(page + 1)}">Next</a>` : ""}</div></nav>${citymotorsFixtureOwner}</body></html>`;
}
export function citymotorsFixtureDetail(
  options: {
    heading?: string;
    year?: string;
    make?: string;
    model?: string;
    vin?: string;
    extraFields?: string;
    status?: string;
    description?: string;
    url?: string;
  } = {},
) {
  const fields = [
    ["Year", options.year ?? "2020"],
    ["Manufacturer", options.make ?? "BMW"],
    ["Model", options.model ?? "X7"],
    ["VIN", options.vin ?? "5UXCW2C09L9B00683"],
    ["Exterior color", "Mineral White Metallic (A96)"],
  ];
  return `<html><head><link rel="canonical" href="${options.url ?? citymotorsFixturePost.url}"></head><body><h1 class="product-page-title">${options.heading ?? "2020 BMW X7"}<br><span class="product-sku">Item Number: <strong>2020BMWX7</strong></span></h1><div class="right-product-description">${options.status === "" ? "" : `<p>${options.status ?? "Available"}</p>`}<div><table>${fields.map(([label, value]) => `<tr><td><strong>${label}:</strong></td><td>${value}</td></tr>`).join("")}${options.extraFields ?? ""}</table></div></div><div class="product-description-block content-block"><h2>Car description</h2><p>${options.description ?? "This vehicle has arrived at our warehouse near Chicago! We are dismantling it. All parts are removed and quality-checked in-house. Local pickup in River Grove, IL."}</p><div class="clear"></div></div><div class="cars-products-block"><h2>Available Parts For The Model</h2><p>2024 Audi Q5 VIN WAUZZZ8R0DA000001</p><table><tr><td>Year:</td><td>2024</td></tr></table></div>${citymotorsFixtureOwner}</body></html>`;
}
