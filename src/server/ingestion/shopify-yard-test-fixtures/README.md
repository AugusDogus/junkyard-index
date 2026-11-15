# Native Shopify-yard evidence

Captured on 2026-11-15 with sequential GETs. Gzip contents are complete response bodies except `modernmuscle-feed.gz`, which retains only the envelope counts/version and explicitly allowlisted donor identity, description, image and availability fields. Its business fields and nested parts were dropped in memory before the first disk write.

| File                      | HTTP 200 URL                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| hawaiiparts-home.gz       | https://aloha.parts/                                                                                                                                         |
| hawaiiparts-yard-html.gz  | https://aloha.parts/pages/yard                                                                                                                               |
| modernmuscle-contact.gz   | https://modernmusclesalvage.com/policies/contact-information                                                                                                 |
| modernmuscle-page-html.gz | https://modernmusclesalvage.com/pages/shop-by-vehicle                                                                                                        |
| modernmuscle-feed.gz      | https://hooks.modernmusclesalvage.com/api/storefront/vehicles                                                                                                |
| lachance-products.gz      | https://mypartdepot.com/collections/part-outs/products.json?limit=250&page=1                                                                                 |
| hawaiiparts-geocode.gz    | https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=91-222%20Olai%20St%20Kapolei%20HI%2096707&benchmark=Public_AR_Current&format=json |
| modernmuscle-geocode.gz   | https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=15980%2032%20Mile%20Rd%20Ray%20MI%2048096&benchmark=Public_AR_Current&format=json |

The native UI fixture verifies the feed URL, list-visible filter and stock-number destination contract. Tests use saved responses only and never contact these sites.

`requests.json` records all 27 sequential live GET attempts (including two Census lookups and eight HTTP429 responses). Eight GETs completed the two live connector censuses. One earlier HTTP200 attempt exposed an incorrect local reader limit and was repeated after fixing it. LaChance's JSON fixture preserves the qualification gap: only 14 of 139 donor bodies carry a VIN. No deferred-yard source is registered.
