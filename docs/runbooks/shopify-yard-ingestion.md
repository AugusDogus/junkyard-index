# Shopify-store yard inventory

Hawaii Parts (`hawaiiparts`) and Modern Muscle Salvage (`modernmuscle`) are independent sources. Both ship disabled. Missing, unreadable or false `ingestion-source-hawaiiparts` and `ingestion-source-modernmuscle` flags keep them out of new production ingestion runs. This change does not enable either source.

| Source                | Physical yard                     | Native census, 2026-11-15           | Accepted | Excluded | Rejected | Floor |
| --------------------- | --------------------------------- | ----------------------------------- | -------: | -------: | -------: | ----: |
| Hawaii Parts          | 91-222 Olai St, Kapolei, HI 96707 | 44 counted cards at `/pages/yard`   |       44 |        0 |        0 |    35 |
| Modern Muscle Salvage | 15980 32 Mile Rd, Ray, MI 48096   | 374 rows in its own storefront feed |      347 |       17 |       10 |   300 |

Hawaii Parts is the first Hawaii provider. Its Tampa location holds parts only and is not registered as a yard. The live roster contains 44 VIN-bearing cards, including two Land Rover cards missed by the earlier research regex. Each vehicle links to its existing `#car-<vin>` anchor. Three relative photo paths are omitted because they are not usable absolute media URLs.

Modern Muscle's own [shop-by-vehicle page](https://modernmusclesalvage.com/pages/shop-by-vehicle) fetches `https://hooks.modernmusclesalvage.com/api/storefront/vehicles` and resolves `?stock=<stock_number>` vehicle links. Only visible `available` and `new_arrival` rows count. New arrivals are explicitly waiting to be dismantled. Hidden, `not_online` and `sold_out` rows are excluded and do not enter observed-VIN retention. Four incomplete identities, two invalid VIN check digits and four conflicting VIN/stock claims are rejected. Check-digit failures are stock SNOW2 (2001 Ski-Doo MX Z 700, `2BP5168581V000013`) and stock 1029 (1995 BMW 540I, `WBAHE6327SGF24417`). The two conflicting VINs are `1GKEK63U84J172749` (stocks 1057 and 2016) and `1GKFK66U54J239534` (1092 and 2055).

The feed is parsed through an explicit donor-field allowlist before checkpointing. Never save or log its raw response: it also contains internal business data. Costs, profits, recovery figures, revenue, purchase data, nested parts and other feed extras are never placed in fixtures, checkpoints, vehicle output or logs. The saved feed fixture is sanitized. Malformed JSON errors omit raw feed snippets.

Both coordinates are Census Public_AR_Current street interpolations, not rooftop pins. The saved Census responses independently match the yard-published addresses: Kapolei `(21.299403051719, -158.099812773634)` and Ray `(42.805030568101, -82.97065485201)`.

## Census and recovery

Each run uses four GETs: opening physical owner, opening complete inventory, closing complete inventory, closing physical owner. Requests are serialized within each provider with a twelve-second completion gap. The combined fetch/body deadline is 25 seconds, the response cap is 4 MiB, and each durable chunk allows at most four GETs within three minutes. Redirects, partial content, wrong content types and unexpected destinations fail closed. There are no automatic HTTP retries. A 429 or 503 honors Retry-After when it fits the remaining chunk budget, with a 60-second fallback and a one-day maximum for absurd values. Longer pauses fail immediately with a typed provider error containing `retryAt` and an ISO retry time; no pacing sleep runs in a finalizer. Short pauses remain interruptible. Before retrying from a fresh process, honor the reported retry time because the in-memory request gate is not durable.

No inventory or observed identities are emitted before both censuses and physical owner checks pass. Opening and closing ordered donor claims must match, including membership, multiplicity and availability. Checkpoints contain only typed allowlisted donor claims, are scoped to the source, yard, endpoint and inventory floor, and have a checksum and 2 MiB cap. Complete cursor replay performs no requests and emits no duplicate batch.

Modern VINs must pass the shared ISO 3779 check-digit validator. VIN validation also supports valid native pre-1981 serials. Rejected active rows retain alphabet-valid native VIN claims for presence protection, including check-digit failures; excluded inactive rows remain absent from observed VINs unless their identity conflicts with another donor. Rejections may not exceed 10% of active rows, duplicates may not exceed 25%, and inventory may not fall below 50% of the previous accepted run. Each source also has the floor above. Conflicting active/inactive identity claims are rejected rather than silently retained as active. Any failed guard preserves prior published inventory. Inspect the native evidence, wait for rate limits, then resume the last validated checkpoint or start a fresh census if its opening inventory is stale. Do not lower guards to force a run through.

## Read-only soak

Run one source at a time. These commands write only local temporary soak state, not production inventory:

```sh
bun run soak:sources -- --sources=hawaiiparts --max-pages=4 --cycles=1
bun run soak:sources -- --sources=modernmuscle --max-pages=4 --cycles=1
```

A smaller request cap returns a paused checkpoint with zero emitted inventory. Offline regression checks:

```sh
bun test src/server/ingestion/shopify-yard.test.ts src/server/ingestion/shopify-yard-client.test.ts scripts/soak-shopify-yard.test.ts
```

Provider parsers and HTTP clients are imported only by fetching/soak code. Workflow-facing registries import the cursor and static yard metadata only.

## Yards deferred

| Yard                               | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LaChance / My Part Depot, Eagle WI | Its donor JSON lists 139 products, but only 14 contain a VIN in `body_html`. Product HTML might expose additional metafields, but repeated detail requests and the terminal-page probe returned HTTP 429 with Retry-After 60. Complete VIN coverage and sold/crushed status could not be qualified. No source is registered. Do not infer donor activity from the zero-dollar product's out-of-stock flag, or interpret “parts are sold individually” as a sold donor. A future implementation must inspect explicit donor sold/crushed markers, exclude inactive donors from observed VINs, close the paginated census, and pass the 10% rejection guard. |
| CNC Autoworks, Winona MN           | Optional. Earlier evidence has six VIN-less vehicles among 48 (12.5% rejection), exceeding the unchanged 10% guard. Three paced live JSON attempts returned HTTP 429 with Retry-After 60, so improved coverage could not be confirmed. No source is registered.                                                                                                                                                                                                                                                                                                                                                                                            |

Qualify deferred yards with slow sequential requests and saved responses before adding them. Keep every new source disabled until its own rollout is authorized.
