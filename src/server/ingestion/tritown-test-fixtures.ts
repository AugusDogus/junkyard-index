export const tritownTestContext = `<html><body>
865 Milton Grove Rd, Mount Joy, PA 17552 1(717) 409-5279
The list below represents the most up to date inventory at our location in Mount Joy.
Please note that pictures of vehicles are taken at the time the car is set in the yard.
<select name="make"><option value="0">Select Make</option><option value="295">Chevrolet</option><option value="25">Ford</option><option value="29">Jeep</option></select>
<select id="wpcm-sort"><option value="power_kw-asc">Year (old-new)</option></select>
<input id="wpcm-listings-nonce" value="6a9d8ed595">
<script>var wpcm = {"ajax_url_get_vehicles":"https://tritownautosalvage.com/?wpcm-ajax=get_vehicle_results"};</script>
</body></html>`;

export function tritownTestCard(
  id: number,
  options: { title?: string; vin?: string; position?: string } = {},
) {
  const title = options.title ?? "2010 Chevy Equinox";
  const vin = options.vin ?? "2CNALBEW8A" + String(id).padStart(7, "0");
  return `<li class="wpcm-listings-item"><a href="https://tritownautosalvage.com/vehicle/test-${id}/">
<div class="wpcm-listings-item-description"><h3>${title}</h3><p>${options.position ?? "Row 2A "}Vin# ${vin}</p></div>
<div class="wpcm-listings-item-meta"><ul><li class="wpcm-title">${title}</li><li>0 miles</li><li>Posted: 11-10-2026</li></ul></div>
</a></li>`;
}

export function tritownTestPage(
  page: number,
  lastPage: number,
  cards = Array.from({ length: 5 }, (_, index) =>
    tritownTestCard((page - 1) * 5 + index + 1),
  ),
) {
  return JSON.stringify({
    listings: cards.join(""),
    pagination:
      "<ul class='page-numbers'>" +
      (page > 1
        ? '<li><a class="prev page-numbers" data-page="prev">Previous</a></li>'
        : "") +
      Array.from({ length: lastPage }, (_, index) => {
        const number = index + 1;
        return number === page
          ? `<li><span class="page-numbers current">${number}</span></li>`
          : `<li><a class="page-numbers" data-page="${number}">${number}</a></li>`;
      }).join("") +
      (page < lastPage
        ? '<li><a class="next page-numbers" data-page="next">Next</a></li>'
        : "") +
      "</ul>",
  });
}
