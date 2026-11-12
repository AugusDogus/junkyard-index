export const importapartTestPost = {
  url: "https://importapart.com/blogs/part-outs/2001-mazda-miata-part-out",
  title: "2001 Mazda Miata - PART OUT",
};
export const importapartTestIdentity = `<script type="application/ld+json">${JSON.stringify(
  {
    "@type": "AutoPartsStore",
    name: "Importapart",
    telephone: "+1-314-502-3104",
    address: {
      streetAddress: "7373 Hazelwood Ave",
      addressLocality: "Hazelwood",
      addressRegion: "MO",
      postalCode: "63042",
    },
  },
)}</script>`;
export function importapartTestListing(
  page = 1,
  posts = [importapartTestPost],
  lastPage = 1,
) {
  return `<html><body>${importapartTestIdentity}<main>
  <p>CURRENT INVENTORY</p><h1>Part Outs</h1><p>Browse the vehicles we're currently parting out. Click any vehicle to see what's available and reach out about specific components.</p>
  ${posts.map((p) => `<a class="partouts-test__card" href="${p.url}"><h2 class="partouts-test__card-title">${p.title}</h2></a>`).join("")}
  <div class="partouts-test__pagination"><span class="partouts-pagination-current">${page}</span>${page > 1 ? `<a href="/blogs/part-outs?page=${page - 1}">←</a>` : ""}${page < lastPage ? `<a href="/blogs/part-outs?page=${lastPage}">${lastPage}</a><a href="/blogs/part-outs?page=${page + 1}">→</a>` : ""}</div>
  </main></body></html>`;
}
export function importapartTestDetail(
  options: {
    title?: string;
    header?: string;
    vin?: string;
    stock?: string;
    vinLabel?: boolean;
  } = {},
) {
  return `<html><body>${importapartTestIdentity}<main><h1>${options.title ?? importapartTestPost.title}</h1>
  <div class="blog-post-content rte"><rte-formatter><p><strong>${options.header ?? "2001 Mazda Miata - PART OUT"}</strong><br><strong>${options.vinLabel === false ? "" : "VIN: "}${options.vin ?? "JM1NB353710207894"}</strong><br>Exterior Color: Red<br>Stock # ${options.stock ?? "10207894"}</p>
  <p>Parts may fit 1999-2005 Mazda Miata</p><p>Transmission SOLD</p>
  <p>Importapart is a full service salvage yard. We are located at 7373 Hazelwood Ave. Hazelwood, Missouri 63042. 314-502-3104. All parts are pulled with pre-payment or deposit only.</p>
  </rte-formatter></div></main></body></html>`;
}
