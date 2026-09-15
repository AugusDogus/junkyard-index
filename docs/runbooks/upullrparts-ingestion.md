# U Pull R Parts ingestion

Source: `upullrparts`. Three verified stores: Rosemount MN (1), East Bethel MN
(2), and Toledo OH (3). No provider credentials are required.

## Public API

POST `https://upullrparts.com/wp-admin/admin-ajax.php`, URL-encoded, with
`action=doApiCall` and `User-Agent: JunkyardIndex/1.0`. The old shared Chrome
user-agent received HTTP 403 during verification.

| `apiAction`   | Additional fields                                        | Purpose                        |
| ------------- | -------------------------------------------------------- | ------------------------------ |
| `getVehicles` | None                                                     | Complete inventory, all stores |
| `getMakes`    | None                                                     | Raw manufacturer labels        |
| `getVehicles` | `makes=<raw label>&models=0&years=0&beginDate=&endDate=` | Make membership                |
| `getModels`   | `Make=<raw label>&ModelYear=0`                           | All-year model relationships   |

Parameter case matters. Preserve raw make labels in requests, including trailing
whitespace. The [public inventory form](https://upullrparts.com/inventory/) and
its `wp-content/plugins/V5.0/vehicle-search.js` script define these requests.

Responses are bare JSON arrays. There is no verified provider pagination or
independent total. HTTP 206, Content-Range, or Link headers fail the checkpoint
rather than allowing a partial inventory or supporting lookup to appear complete.

## Make resolution

Vehicle rows contain year, model, VIN, stock, row, date, and store, but no make.
Records without usable VIN/year/model are counted as rejected before enrichment.

For usable records, join make-filtered inventory to the original catalog by
store, stock number, VIN, year, and model. Only unique membership establishes a
make. If usable records remain unmatched, query model lists for every make and
accept only unique relationships. Some model labels occur under multiple makes,
so neither the first match nor model-name/VIN guessing is reliable.

Supporting responses never add, remove, or reorder original inventory. Ambiguous
or unmatched makes remain `Other` with warnings; failed supporting requests fail
the checkpoint. In the September 15 sample, three valid listings required the
model fallback and all makes ultimately resolved.

## Checkpoints and execution budget

- Cursor `0` means pending, `1` complete. One atomic catalog checkpoint per run;
  callback batches contain at most 250 vehicles. A failed checkpoint retries the
  catalog from `0`.
- Maximum catalog/partition size: 20,000 rows. At most 64 makes and 500 model
  labels per make. Empty, malformed, oversized, or missing-known-store catalogs
  fail before publication. Shared acceptance requires at least 2,000 vehicles
  and applies previous-run drift, rejection, and duplicate checks.
- Requests start at most once every 1.5 seconds, including retries. A four-minute
  connector timeout bounds enrichment; deployment execution must allow that plus
  checkpoint persistence. The measured run used 114 requests, about 170 seconds,
  and emitted 3,303 vehicles. Without model fallback, 56 makes need 58 requests.
- Unknown yard IDs produce warnings and observed VINs, using the shared
  observation path to preserve existing inventory.

## Yard metadata

Addresses and phones come from the [public contact page](https://upullrparts.com/contact/);
coordinates are public map pins, not city/ZIP centroids. The Rosemount page body
lists 2871, while its footer and named business map pin agree on **2985 160th St W**;
the configured metadata uses 2985. Metadata is in `upullrparts-yard-metadata.ts`.
The shared contact page is not published as a yard-specific website.

## Local verification

```sh
bun run soak:sources -- --sources=upullrparts --cycles=1
bun test src/server/ingestion/upullrparts-connector.test.ts src/server/ingestion/upullrparts-transform.test.ts src/server/ingestion/upullrparts-makes.test.ts
```

The soak counts and discards inventory. It does not publish database changes,
Algolia records, or notifications.
