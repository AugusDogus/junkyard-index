# U Pull R Parts photos and outbound links

Verified September 16, 2026 against the public site, starting from `b79e8ba`.

## Root cause and photo contract

The transform hardcoded `imageUrl: null`. The complete catalog has no photo URL,
photo count, or image-availability flag. The shipped
[`vehicle-search.js`](https://upullrparts.com/wp-content/plugins/V5.0/vehicle-search.js?ver=1789392219)
uses a second public request for each stock:

```text
POST https://upullrparts.com/wp-admin/admin-ajax.php
Content-Type: application/x-www-form-urlencoded
action=doAaaApiCall&apiAction=getVehicleImages&stockID=UG072546
```

Success is `{ "success": 1, "images": [{ "fileName": "...jpg", "url": "..." }] }`.
No photos is `{ "success": 1, "images": [] }`, not a placeholder URL. Missing
stock returns HTTP 400 `invalid_stock`. Filenames include upload timestamps;
stock-only paths cannot be reconstructed from inventory. The CloudFront builder
in the same script is for full-service **parts**, not these vehicle photographs.

`upullrparts-images.ts` uses returned URLs only, verifies stock/filename/host
agreement, and mirrors thumbnail order `6, 3, 4, 1, 5, 2`. Invalid data and failed
requests fail the checkpoint before any yard or vehicle callbacks. Missing stock
and successful empty image lists remain null. Lookups are deduplicated by stock.

## Three-yard browser evidence

The public form was submitted with Location Minnesota (`site=1`, both MN yards)
or Toledo (`site=3`), Any make/model/year, and both date fields `2026-09-16`.
Each rendered table row contained the stock and VIN below. Each selected image
was then opened directly after closing and restarting named browser session
`audit-upullrparts`: empty referrer, `complete=true`, nonzero natural dimensions.
Visual inspection confirmed the corresponding red Kia, white Hyundai, and gray
Pontiac, not placeholders.

| Yard        | Vehicle              | Stock    | VIN               | Exact returned photo                                                                | Natural dimensions |
| ----------- | -------------------- | -------- | ----------------- | ----------------------------------------------------------------------------------- | ------------------ |
| Rosemount   | 2011 Kia Sportage    | UG072616 | KNDPB3A22B7093401 | [JPEG](https://api.aaaparts.com/staticImages/UG072616_6_Facebook_1789569476269.jpg) | 3072 × 4096        |
| East Bethel | 2013 Hyundai Accent  | NG068336 | KMHCT4AE1DU451163 | [JPEG](https://api.aaaparts.com/staticImages/NG068336_6_Facebook_1789569607766.jpg) | 4096 × 3072        |
| Toledo      | 2006 Pontiac Torrent | CP022395 | 2CKDL73F266090391 | [JPEG](https://api.aaaparts.com/staticImages/CP022395_6_Facebook_1789564450578.jpg) | 3072 × 4096        |

Local audit evidence is `/tmp/opencode/upullrparts-{rosemount,east-bethel,toledo}.png`
for table rows and matching `*-image.png` files for fresh direct image opens.
The browser session was closed after verification.

## Outbound link limitation

The previous `detailsUrl`, `https://upullrparts.com/inventory/`, is a generic
search entry point. Submitting the public form does not change this URL. Result
rows have photo buttons and pagination fragment links, no vehicle-detail links.
The shipped script has no query/hash restoration or persistent results route.

Opening that exact URL in a fresh browser produced no form, rows, sample stocks,
or VINs. Testing the actual form fields as GET parameters also produced zero rows:
`/inventory/?site=1&makes=Kia&models=SPORTAGE&years=2011&beginDate=&endDate=`.
Evidence: `/tmp/opencode/upullrparts-query-not-restored.png`.

No direct or persistent filtered URL was verified. `detailsUrl` is now null rather
than claiming the empty search page is a vehicle detail page. The table's stock
and VIN remain available for a manual search from the provider inventory page.
Do not publish the failed GET probe as a supported link. Persistent outbound
results remain an upstream limitation; no new URL parameters were invented.

## Runtime and checks

The public UI issued ten overlapping thumbnail lookups in a 1920 × 1080 browser.
Photo enrichment uses at most eight concurrent requests, including retry slots.
The catalog/make 1.5-second gate, authoritative make resolution, 600-second outer
deadline, atomic cursor, 250-row batches, accounting, and yard policy are retained.

The full read-only connector run took **470.511 seconds** and completed cursor 1:

| Yard        | Vehicles | Photos | Successful empty photo lists |
| ----------- | -------: | -----: | ---------------------------: |
| Rosemount   |    1,286 |  1,194 |                           92 |
| East Bethel |    1,128 |  1,118 |                           10 |
| Toledo      |      897 |    705 |                          192 |
| Total       |    3,311 |  3,017 |                          294 |

Requests: 57 `getVehicles`, 1 `getMakes`, 56 `getModels`, 3,311 `getVehicleImages`.
Peak photo concurrency was eight. No errors, warnings, exclusions, rejections, or
duplicates. This adds one lookup per distinct usable stock, roughly 300 seconds
in this run, with about 129 seconds remaining before the hard deadline. No
database, Algolia, or notification writes were made. Slower upstream service can
still fail the existing deadline; it cannot return a partial terminal checkpoint.

Checks: `bun run check`, `bun test src`, and targeted oxfmt checks. Regression
coverage includes returned photo preference, empty lists, wrong-stock/placeholder
rejection, bounded concurrency, deduplication, failure-before-publication, retry
from cursor zero, and the shared ten-minute photo deadline.
