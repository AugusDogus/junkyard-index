# Vander Haags Sioux Falls ingestion

The enabled `vanderhaags` source adds Vander Haag's Sioux Falls, South Dakota.
The native catalog explicitly labels these vehicles `Parts Unit: Truck`.
Full-service heavy-truck donors meet the existing admission policy.

## Qualification, November 17, 2026

- [Native catalog](https://www.vanderhaags.com/New-Salvage.php?inventorytype=parts-unit&order=new-salvage&items=500): five pages, 2,112 unique national donor IDs, 287 explicitly assigned to Sioux Falls.
- All 287 Sioux Falls details checked: 276 accepted, 11 conflicting model descriptions quarantined, zero duplicate VINs. See the [qualification receipt](vanderhaags-qualification.json).
- Modern VINs pass ISO 3779 check digits. The 1978 Ottawa YT, native ID `25995129`, publishes serial `51564` and stock `78MI012`.
- Each accepted donor has native year, make, model, stock, yard and a `/detailview.php?part=<id>` destination. No make/model is inferred from a VIN or repaired to reconcile conflicting text.
- Donor `26038856`, stock `17KN110`, links [its video](https://www.youtube.com/watch?v=nr8iKJ9-PTc), published November 10, 2026. This establishes recent inventory activity. It is not an arrival date: `availableDate` remains null.
- The official yard is 1423 E 54th St N, Sioux Falls, SD 57104, coordinates 43.594099, -96.709450. The location page supplies the general 888-940-5030 phone.

The native `/searchtemplate_ajax.php` handles `refreshsearchresults`,
`refreshfilters` and `getcanonical`; it returns HTML, not a discovered bulk VIN
JSON feed. The connector uses the finite native donor catalog and its details.
Component search results and other yards are excluded.

## Transport and request budget

Plain HTTP requests encounter AWS WAF 202, and a default headless browser
encounters 403. A normal browser navigation completes the JavaScript challenge.
The production Hyperbrowser transport was verified with stealth, accepted
cookies and the `us-west` region. It reuses the initial rendered catalog for
the first catalog read and uses same-origin browser fetch for later documents.

Requests are serial with a 1.6-second gap. Each checkpoint processes 12 detail
documents by default, with a maximum of 24 and a four-minute deadline. At the
qualified census, a full default run uses **412 inventory document requests**:

- 24 opening five-page national catalog enumerations: 120 requests.
- All 287 Sioux Falls details: 287 requests.
- Final five-page closing census: five requests.

Browser assets, session setup and WAF challenge traffic are additional. A fresh
production-transport checkpoint emitted 12 validated donors in 17 document
requests. A full saved-live-response replay completed all 24 checkpoints with
276 accepted donors, 11 rejects and 412 document reads. This is not a claim
that a second full live production-transport run was performed.

## Reconciliation safeguards

Every catalog page must match native pagination counts, selected donor scope,
current page and expected page length. All national donor IDs must be unique.
The Sioux Falls census must contain at least 95 donors with unique stocks.
The registered source floor is also 95, approximately one third of the census.

Checkpoint cursors bind the ordered national catalog identities, title, stock
and yard to a SHA-256 digest, plus the detail offset, cumulative rejects and
seen VINs. A changed census, repeated page, repeated VIN, invalid cursor,
truncated document, detail identity/stock disagreement or ambiguous yard stops
the checkpoint. The final closing census must match before completion emits.
Earlier validated batches do not authorize removal after a later failure.

Conflicting required descriptions are individual rejects. Their usable native
identities supply presence evidence without publishing guessed descriptions.
The cumulative rejection ceiling is 10%. Shared source validation retains the
previous-run 50% drift guard and prevents reconciliation below the source
floor. Failures preserve prior inventory.

Native specifications legally omit one Price row's closing `tr` tag. The
parser accepts that syntax while requiring complete cells and the enclosing
table. The Western Star headline truncates `4900EX` to `4900E`; catalog title
and specifications agree on `4900EX`, and native inventory ID, stock, quantity
and yard bind the detail. A headline is not used to overwrite that model.

## Verification and operation

Fixtures contain minimized native catalog/detail markup, including the Ottawa
serial and Western Star model. Tests cover check digits, field conflicts,
stock/yard binding, pagination and truncation, resumable batches, duplicate
VINs across checkpoints, the census floor, cumulative rejects and closing
fences. The soak helper respects its detail cap and retains a paused cursor.

The following command is a live diagnostic, not an offline test:

```sh
bun run soak:sources -- --sources=vanderhaags --cycles=1 --max-pages=12
```

`--max-pages` counts donor details for this source. Each checkpoint also reads
the national catalog. Missing pause flags leave newly registered providers
enabled; `ingestion-source-vanderhaags=false` pauses this source. No production
flag, database, deployment or merge was changed during qualification.
