# Next VIN-bearing provider candidates

Public-source research on September 15, 2026. Wrench-A-Part and U Pull R Parts
have separate implementation runbooks. iPull-uPull, Washington U-Pull-It, and
Parts Galore are now implemented; see [their runbook](runbooks/independent-yard-ingestion.md)
for measured full crawls and current filtering. The table retains discovery samples.

Overlap means tested unique VINs found in the public Row52 active inventory and
AutoRecycler global search. Both lookups passed positive controls. Zero sampled
matches is not proof of catalog-wide exclusivity or absence from every existing
connector. Counts describe published records, not independently verified cars on
the lot.

| Priority | Provider                                                                                | Yard scope                                        | Public inventory                                                  | Observed size                                                              | Row52 / AutoRecycler overlap       |
| -------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------- |
| 1        | [iPull-uPull](https://ipullupull.com/inventory-pricing/)                                | Fresno, Pomona, Sacramento, Stockton CA           | CSV export linked by the public catalog                           | 4,260 yard-assigned records, 4,188 distinct 17-character VIN-shaped values | 0/120 / 0/120, 30 per yard         |
| 2        | [Fenix U-Pull](https://fenixupull.com/recent-inventory/)                                | Elmira, Binghamton, East Syracuse NY; Moultrie GA | HTML pagination with VIN, stock, date and yard                    | 154 sampled rows; 126 pages imply about 6,254 rows, not a completed crawl  | 0/90 / 0/90                        |
| 3        | [Washington U-Pull-It](https://go2upullit.com/inventory/ANY/ANY/?k=1&id=ANY&view=table) | Yakima, Pasco, Kennewick WA                       | Six linked inventory pages                                        | 2,481 rows; 2,470 distinct VIN-shaped values                               | 0/30 / 0/30                        |
| 4        | [Parts Galore](https://parts-galore.com/inventory/)                                     | One confirmed Detroit MI yard                     | Full HTML table                                                   | 1,059 rows; 1,058 VIN-shaped values                                        | 0/30 / 0/30                        |
| 5        | [Budget U Pull It](https://budgetupullit.com/current-inventory/)                        | Winter Garden, Orlando area FL                    | Make-filtered HTML searches                                       | Recent and Ford samples contain 396 distinct VINs combined; no full count  | 0/30 / 0/30 in each of two cohorts |
| 6        | [Indian River U-Pull-It](https://indianriverautosalvage.com/inventory-3/)               | Vero Beach FL                                     | Three HTML pages                                                  | 1,049 rows; 1,028 distinct VIN-shaped values                               | 0/30 / 0/30                        |
| 7        | [Pick-n-Save Virginia](https://pick-n-save.net/vehicles/)                               | Lynchburg/Rustburg and Roanoke VA                 | WordPress product REST listing plus vehicle detail pages for VINs | REST reports 1,718 products; 10/10 sampled details publish VINs            | 0/10 / 0/10                        |
| 8        | [Route 34 U-PULL-M](https://route34upullm.com/inventory/)                               | Auburn NY                                         | Full HTML table                                                   | 355 rows; 347 distinct VIN-shaped values                                   | 0/30 / 0/30                        |

## Important corrections and implementation notes

- **iPull-uPull was previously dismissed without sufficient overlap evidence.**
  The current four-yard sample does not support that decision. Use the current
  [CSV export](https://ipullupull.com/inventory-pricing/?ipull_export=1&slug=inventory-pricing&type=inventory&format=csv),
  not just the legacy per-yard files: the old Sacramento file is empty. Parse CSV
  quoting properly and inspect Available/Sold status and full-service-only rows.
- Fenix's current selector lists four yards, but old Belleville MI records remain
  in inventory. Do not count that as a confirmed operating fifth location.
- Parts Galore's current contact information identifies one yard. Old claims of
  three locations and 7,500 vehicles are not supported by the inspected table.
- Washington U-Pull-It uses yard codes JJ65 (Pasco), UU44 (Kennewick), UU43
  (Yakima). Follow pagination links, not a fixed expected row count.
- Budget's bare inventory page is empty until a make is selected. That is not
  evidence that the yard has no cars.
- Indian River repeats some VINs under different stock/date entries. Decide a
  deterministic source-record selection before ingesting duplicates.
- Pick-n-Save's REST type is `product`; VINs are on the linked details. Some
  published records contain crush-related notes, requiring availability checks.
- Short legacy chassis numbers and malformed VINs occur in these feeds. Do not
  repair them by guessing characters or padding numbers.

## Additional leads requiring enumeration work

- **[Nevada Pic-A-Part](https://nvpap.com/part-interchange.html):** North Las Vegas
  and Henderson. Public POST `/wp-json/pt1/v1/vehicle-stock` returns an HTML-length
  prefix followed by HTML and JSON search results. Combined and per-store queries
  each returned 200 rows, suggesting a cap. Prove full enumeration before building.
  Thirty sampled VINs matched neither aggregator. Store IDs: 1074 and 1075.
- **[S&W Used Auto Parts U-Pull](https://www.sandwauto.com/u-pull/inventory-search):**
  Lithonia GA. Twenty actual table VINs matched neither aggregator. Investigate
  Wix dataset pagination; twenty is a sample, not a yard total.
- **[Harry's U-Pull-It](https://wegotused.com/our-inventory/):** three PA pull yards.
  Direct requests hit a JavaScript/Sucuri challenge. No fresh VIN or overlap
  verification was obtained in this pass.

## Repeating the overlap check

For Row52, query `/odata/Vehicles` with `isActive eq true` and at most ten exact
VIN predicates per request. Compare VIN sets, not response row counts. For
AutoRecycler, use the existing global msearch client and a `vin_text` `in`
constraint. First confirm each filter returns a known positive-control VIN.
Sample across yards and the catalog rather than only the newest arrivals.

The discovery pass visited eleven named leads and three additional yards. No
messages, signups, production database writes, or paid services were used.
