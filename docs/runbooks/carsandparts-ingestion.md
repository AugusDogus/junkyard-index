# CarsAndPartsHub donor inventory

`carsandparts` runs by default and adds one physical New Jersey yard, with a
25-vehicle floor against 77 accepted donors on November 17, 2026. Serving false
from `ingestion-source-carsandparts` pauses the source. No production flag was
created or changed.

The native [donor collection](https://www.carsandpartshub.com/collections/donor-cars)
states that every vehicle is dismantled by hand in Lumberton, NJ. Its Recycar
logo and independently named Cars And Parts Hub and Recycar map listings agree
on 1807 Route 38, Lumberton Township NJ 08048. The exact Cars And Parts Hub
business marker supplies `(39.9775847, -74.7554689)` and 640-202-3856.
The native collection establishes yard ownership and city; it does not publish
that street address. The saved markers preserve that distinction.

The complete Shopify collection API is
`/collections/donor-cars/products.json?limit=250&page=1`. Its 77 unique donors
match all 77 native collection links. A short page terminates Shopify's public
pagination. A response with 250 products fails closed until pagination has been
qualified. No product-detail crawl is needed. Native product destinations use
`/products/vehicle-<UUID>?view=donor`.

All 77 donors have valid check-digit VINs, production year, make and model.
`veh_production_year_YYYY` establishes donor year. Generic `year_*` tags are
fitment ranges and must not be used as donor year. Secondary donor make/model
tags must agree when present. All variants were available at capture time;
products without an available variant are excluded. Photos, stock and color
remain optional. API creation timestamps are not copied as arrival dates.
The collection labels arrivals in November 2026, and its newest API product
was created on November 16, 2026.

Each full run makes **four GETs**: opening owner collection, opening API,
closing API, closing owner collection. The shared Shopify reader uses a normal
browser User-Agent, serialized requests and a 12-second completion gap. It
rejects redirects, partial responses, wrong content types and bodies above
4 MiB. The shared connector requires matching ordered donor claims and both
ownership checks before publishing. Checkpoints contain only typed donor
claims. VIN validation, rejection and duplicate limits, the 25-vehicle floor
and the 50% previous-run drift guard preserve prior inventory on failure.
See [shared Shopify recovery rules](shopify-yard-ingestion.md#census-and-recovery).

Earlier Python urllib requests returned 429. Ordinary Bun fetch, using the
production reader's browser headers, recovered 200 responses without cookies
or a bypass. Exact opening/closing bodies and SHA-256 receipts are committed
under `carsandparts-test-fixtures/`. The independent closing API differs in
irrelevant storefront metadata, while every parsed donor claim matches.

```sh
bun test src/server/ingestion/carsandparts.test.ts
bun run soak:sources -- --sources=carsandparts --max-pages=4 --cycles=1
```

The soak writes local state only. Do not use a partial or failed census to
replace published inventory or lower the guards to accept it.
