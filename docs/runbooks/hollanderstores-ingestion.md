# Hollander Stores ingestion

The `hollanderstores` source ships disabled. It covers five separate businesses, adding VT and MA to provider coverage and adding depth in CT and WI. It does not alter the existing `beavers` source, tenant 503, or its make policy.

## Qualification on November 15, 2026

| Yard                                | Published address                      | Tenant                 | Published | Accepted | Rejected | Missing native make |
| ----------------------------------- | -------------------------------------- | ---------------------- | --------: | -------: | -------: | ------------------: |
| LeBlanc's Auto                      | 37 Willow Rd, Bennington VT 05201      | leblancsauto / 4573    |       541 |      541 |        0 |                 173 |
| Monster Junkyard                    | 1745 Page Blvd, Springfield MA 01104   | blvdautoparts / 8069   |        83 |       83 |        0 |                  15 |
| Standard Used Auto Parts & Wrecking | 257 Granite St, Worcester MA 01607     | standardauto / 2329    |        85 |       79 |        6 |                  15 |
| Petrillo's Used Auto Parts          | 150 Middletown Ave, New Haven CT 06513 | petrillosauto / 1975   |        61 |       59 |        2 |                   8 |
| Kirchhayn Auto Parts                | W4726 County Road A, Fredonia WI 53021 | kirchhaynautopa / 6549 |       114 |      114 |        0 |                  24 |

All five qualify: 876 accepted, eight rejects, no duplicate VINs or destinations. Standard's six rejected VINs include two short VINs and four check-digit failures, 7.1% of its published roster. Petrillo has two check-digit failures. Each yard must independently remain at or below 10% rejects; the larger LeBlanc census cannot conceal a failing smaller yard. Accepted floors are respectively 450, 65, 65, 45 and 90, plus a 700-vehicle source floor. Shared validation applies the 50% previous-count drift and 25% duplicate guards. Conflicting duplicate VIN claims are rejected and their structurally valid VINs preserve existing presence.

Two independently captured card rosters per tenant match all parsed rows, counts, VINs, stock numbers, headings and vehicle destinations. Exact response bodies are saved as gzip fixtures with byte counts and SHA-256 receipts. Tests replay them offline. Qualification made ten serial Hollander POSTs, five Census GETs and two business-website GETs (normal website redirects followed), with three-second gaps between requests in each capture. No new vPIC requests were needed: the verified November 15 investigation already decoded all 884 VINs. Its successful VIN-to-make results bootstrap the production cache in `hollanderstores-vpic-seed.json`.

LeBlanc's published inventory contains 461/541 vehicle IDs below 68.24 million, predating approximately early 2025; 48/541 are at least 70.87 million, approximately since early 2026; 32 fall between those ranges. These are record-ID age estimates, not acquired dates. Include all published donors. The platform lists them as current inventory, but on-lot availability of the oldest records remains unverified. Monster's 83 and Petrillo's 61 records are all in the newest range; Standard has 73/85 and Kirchhayn 85/114 in that range. Available dates remain null.

## Identity, location and links

Each tenant's `hpdcLogo` must match its verified business name, and each native per-vehicle link must remain on that tenant and its numeric tenant ID. Phone evidence from the investigation ties each tenant to its business. [Monster's website](https://monsterjunkyard.com/) publishes 1745 Page Blvd, resolving conflicting directory numbers. [Kirchhayn's website](https://www.kirchhayn.com/) publishes W4726 County Road A. [Petrillo's website](https://petrillosauto.com/) links its Hollander tenant. LeBlanc's published address and Standard's published address were verified in the supplied investigation.

Coordinates come from US Census `locations/onelineaddress`, benchmark `Public_AR_Current`, for each published street address. Full matched responses are fixtures. Census matched Kirchhayn's street as W4726 CO HWY A. Every vehicle and yard uses its own matched point, address, name and state. Website fallbacks resolve each individual tenant, and vehicle links use the published `/VehicleDealerShowParts/{tenantId}/{vehicleId}` route. The site redirects these routes to matching vehicle parts results. No generic platform inventory link replaces a vehicle destination.

## Make and VIN policy

The platform's make lookup is incomplete. Empty makes are a platform display problem, not bad yard input. Preserve the native year and Hollander model code. Expand the two-digit year to its latest valid century under the canonical vehicle-year range.

Only rows with a missing make and a valid 17-character VIN need a vPIC decode. Modern VINs must pass the ISO 3779 check digit in this provider only. Batch at most 50 unique VINs per POST to `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/`, using `format=json` and semicolon-separated `data`. Require exact response VIN membership and multiplicity. An empty or placeholder decoded make is a row reject, never a guessed make. A transport, malformed response or cache failure stops the chunk, preserving prior inventory and checkpoint.

Successful decoded makes are cached permanently per VIN under `hollanderstores:vpic-make:v1:` in the existing Upstash Redis. The verified audit seed avoids repeating past government lookups, including known conflicting native makes. Failed decodes are not cached across runs. Newly decoded values also persist in the durable cursor, so resume does not repeat completed batches. Cache reads for populated native makes never trigger decoding.

If a published make contradicts an available decoded make, retain the published make and report the VIN and both makes in warnings. The current audit reports LeBlanc's H3 as published American Motors versus NHTSA Hummer, and LeBlanc's Nitro as published Jeep versus NHTSA Dodge. Normalize the Alfa-Romeo spelling difference without a conflict. These diagnostics do not silently rewrite the yard's published make.

## Enumeration and operation

POST `/VehicleDealerSearch` with `hdnChangeDisplay=card`, the site's own Card View form, once per yard for the opening pass and once per yard for the closing pass. Each response contains the whole yard. Reuse Beaver's HTML parsing helpers and the shared complete-response reader. Reconcile the published count against every card and enforce exact tenant destinations. Missing or duplicate destinations, truncation, changed identity or opening/closing drift stop acceptance.

The durable state machine gathers all five yards, resolves missing makes in ordered batches, closes every yard, validates per-yard and whole-source quality, then emits one complete vehicle batch and five yards. Paused chunks emit no inventory or accounting. Terminal resumes make no requests and emit nothing. Cursors bind the source contract, yard metadata, prior accepted count, ordered decode frontier and completed closing position, with a corruption checksum and 2 MiB serialized bound. A census expires after two hours.

The module-wide semaphore allows one Hollander/vPIC request at a time and holds through cancellation, response cleanup and a three-second gap, including failures. Use current browser headers, manual redirects, a combined 120-second transport/body deadline and a 4 MiB response cap. Temporary `/Message` redirects and transport failures retry twice, with 20 seconds between attempts. A durable chunk permits one logical operation by default and has an eight-minute deadline. A decode batch satisfied by cache still advances one logical operation. Maximum census size is 10,000 cards and 210 logical operations, each allowing at most three physical attempts. Parser and quality failures do not retry within a chunk.

Run the count-only live soak deliberately:

```sh
bun run soak:sources -- --sources=hollanderstores --cycles=1
```

Its budget counts logical operations, including cached decode batches. Capped runs retain a checked paused cursor. Soak results do not enable `ingestion-source-hollanderstores`. Do not enable, deploy or merge as part of qualification.
