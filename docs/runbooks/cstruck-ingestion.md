# C&S Truck Sales & Salvage ingestion

The default-off `cstruck` source adds South Dakota's first provider: C & S Truck Sales, LLC, a self-described truck salvage yard at 24988 350th Ave, Pukwana SD 57370, phone 605-894-4100. Its operator website says it is an auto salvage yard and sells out-of-commission trucks for parts. This is heavy-truck inventory, with limited value for passenger-car searches.

The approved policy admits HeavyTruckParts.net Complete Vehicle listings as donor vehicles for this salvage yard, as for Dutchers. The generic Vehicle For Sale heading does not imply a retail exclusion for this supplier. Most records say CAB & CHASSIS, have no price and show only the supplier logo. Previous research found VIN-linked parts on five of 18 sampled trucks. This catalog is a subset of the yard's vehicle registry; it does not claim to enumerate unpublished registry stock numbers.

The November 15, 2026 live census reconciles 64 distinct supplier 7131988/store 1 items to the store's independent Complete Vehicle count. Two actual passes return 10, 22, 13 and 19 records for 1970-1998, 1999-2003, 2004-2006 and 2007-2027. It accepts 59 vehicles, rejects five (7.8125%), and has zero duplicates or exclusions. Rejects remain in the denominator:

- Item 6130: post-1981 GMC military serial C531-01398.
- Item 6899: truncated 16-character VIN 1XPHDPX1CD155653.
- Item 4763: VIN 1HSHXAHR8SJ049429 fails its check digit and was verified as a wrong-year listing.
- Item 8249: VIN 3C63RRGL9LG210160 was independently verified as a RAM, but the native listing says UD TRUCK UD1200. It is quarantined without repairing the native make/model.
- Item 6692: a Transcraft trailer labeled TRAILER, with description FLATBED.

The valid identities on rejected records protect observed presence. The partial-decode Freightliner 1FUPUXZB51PG05636 has a valid VIN, year and make and remains eligible. Native model wording is preserved. Engine and transmission are retained when present. Logos become null images. Stock, arrival date and yard row remain null. Each vehicle links directly to its native `/item/.../Vehicle-For-Sale/7131988/1/{id}` destination.

Coordinates 43.760066942433, -99.182783487055 come from a unique Census Public_AR_Current match for the published address. This is street-range interpolation on TIGER 199152457, right side, range 24998-24900, not a parcel or rooftop point. The original Census response is saved with the other evidence.

The collector reads the opening store count, enumerates all four ranges, repeats every actual range request and verifies the closing store count. A 25-row response, with or without Next, is bisected into disjoint year ranges. Page-number links and inquiry routes are never requested. A single year at the cap stops the run. Missing years or years outside the published 1970-2027 controls fail the independent count check. The separately captured ascending page confirms the current oldest inventory starts in 1985.

No vehicles, yard, accounting or presence emit until all closing identities, metadata, destinations, ranges, pagination and store counts match. Checked cursors reconstruct the exact traversal frontier and bind request/byte accounting, supplier scope and previous accepted count. Terminal resume emits nothing and makes no requests. Shared validation enforces a 50-vehicle floor, 10% rejection and 25% duplicate ceilings, plus the previous-count 50% drift guard before reconciliation.

The HTTP client and parser are shared with Dutchers without changing its source key or enumeration policy. A process-wide shared-host semaphore covers complete responses and a completed four-second gap, including failures. Each chunk allows eight serial GETs and a four-minute deadline. Whole-run bounds are 32 requests, one hour, 2 MiB per response and 4 MiB per checkpoint. The normal current census costs ten GETs. Requests require unredirected complete HTTP 200 HTML and do not retry. A block, ownership change, unsupported scope, incomplete count or quality failure preserves prior inventory and the last validated checkpoint. Inspect saved evidence before restarting.

`src/server/ingestion/cstruck-test-fixtures/native.json.gz` contains all 16 original public responses. `receipts.json` records their URLs, HTTP statuses and request timestamps. Qualification used 13 HTP requests (including robots, the ascending check and an empty-range check through the production client), two operator requests (robots and homepage), and one Census request. Requests were serial with at least 4.1 seconds after completion; the operator homepage was requested only once, respecting its 60-second crawl delay. Tests replay offline and never contact these services.

The count-only soak discards vehicles and returns a paused checked cursor at its GET cap:

```sh
bun run soak:sources -- --sources=cstruck --cycles=1 --max-pages=32
```

This is a live diagnostic. Do not run it as part of offline tests. `ingestion-source-cstruck` ships disabled by default. Qualification does not enable, deploy or merge this provider.
