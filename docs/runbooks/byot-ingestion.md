# BYOT Auto Parts ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

BYOT has five self-service yards. All coordinates below are the yard's own
published `GeoCoordinates`, checked against its published city, address and a
city bounding box. No Census match or inferred highway address is required.
The saved location snippets preserve both the requested and canonical page URL.

| Yard                | Code | Published address                                  | Latitude, longitude   | Coordinate page                                                              |
| ------------------- | ---- | -------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| Waco / Elm Mott, TX | 1123 | 14401 N. Interstate 35 Frontage Rd, Elm Mott 76640 | 31.6934, -97.10259    | `/locations/waco/`                                                           |
| Bryan, TX           | 1183 | 3738 E State Hwy 21, Bryan 77808                   | 30.70017, -96.35607   | `/locations/bryan-college-station/`                                          |
| Beaumont, TX        | 1218 | 7516 Shady Ln, Beaumont 77713                      | 30.058371, -94.218987 | `/locations/beaumont/`                                                       |
| Port Allen, LA      | 1259 | 4007 I-10 Frontage Rd, Port Allen 70767            | 30.45223, -91.28975   | `/locations/baton-rouge/`                                                    |
| Jackson, MS         | 1289 | 908 S Roach St, Jackson 39201                      | 32.287203, -90.188693 | `/locations/jackson/` (canonical `/locations/jackson-ms/vehicles-for-sale/`) |

All coordinate pages are on `https://www.byotautoparts.com`. Jackson's shared
location schema explicitly identifies 908 S Roach St and Jackson, MS. Its donor
destination is `/locations/jackson-ms/inventory/`, taken from the native links.
The coordinate source's retail-page canonical URL is not a donor destination.

## Daily arrivals and weekly search

The arrivals API only lists photographed vehicles. Each daily run reads
`https://api.byotautoparts.com/inventory/yard/vehicles/recent-arrivals?limit=5000`
once per yard with a `Location: <yard code>` header. A response reaching 5,000
rows fails closed. A missing list, HTTP error or unexpected response cannot
be treated as empty inventory.

The native search needs both a make and a model. Search year is deliberately
omitted because the API ignores it. The qualified directory contains 1,338
queries derived from the site's year-specific menus: the 1980-2025 make/model
union, saved older Ford spellings and the 1955 Jeep menu. Equivalent modern
manufacturer menus collapse to one representative make. Jeep additionally
crosses every Chrysler and AMC name under make `JEEP`, including Wrangler,
Compass and Renegade. `JEEP TRUCK` finds the 1955 CJ5. The saved native controls
reproduce the directory offline. Native listing year/make/model remain the
vehicle's identity; the query labels never substitute for them.

Each run searches 192 controls per yard, so seven daily publications cover
all 1,338 queries. That is 965 requests per daily run, including the five feeds.
All requests are serial with a two-second pause after body completion, even
on failure. Typical source runtime is about 40-50 minutes. Chunks allow eight
requests and four minutes; a resumed daily run older than two hours fails and
must restart from its preceding publication. Each response has a combined
45-second request/body deadline and a 2 MiB cap, with no automatic retries.
HTTP 429, redirects, partial responses, wrong MIME types and unowned URLs stop
the run. Resume only after the provider's Retry-After interval has elapsed.

Today's arrivals feed is authoritative for photographed stock, including any
corrected VIN or model. A photographed car leaves search the day it leaves the
feed, even if an older search bucket still lists it. Its old VIN is not kept as
preservation evidence. Only cars without photos can be added from search alone.
An unphotographed car leaves within a week, when its sweep slice re-checks it,
assuming daily runs succeed. Search-only additions can also take up to a week.

Query buckets persist until their own slice replaces them, including when that
slice returns an explicit empty response. Missed days delay the sweep but do
not expire buckets for queries still in the directory. A bucket whose query has
been removed from the site's make/model list expires after 21 days without a
refresh. A first publication has current photographed inventory plus its first
search slice; the search cache fills over the first seven daily publications.

The durable adapter loads only the latest accepted, search-published BYOT
terminal cursor. Failed, partial or unpublished runs cannot advance its weekly
offset. Checkpoints bind the qualified directory and yard metadata, validate
the contiguous per-yard search prefix, carry previous published yard counts,
and have a 16 MiB cap. Snapshot cleanup preserves terminal source cursors.
Provider imports stay inside step-side ingestion modules, outside Workflow
orchestrator imports.

## Validation and qualification

Every donor must carry a VIN or supported pre-1981 serial, native year, make,
model and the yard's stock prefix. Modern VINs must pass their check digit.
No VIN decoding, year inference, make inference or identity repairs are used.
Null dates and absent photos remain null. Accepted donors link to the correct
yard's native inventory search, with instructions to match VIN, stock and row.

Older bucket rows cannot override or quarantine a stock listed in today's
feed. For search-only stock, the latest refresh replaces older identity claims.
Conflicting required claims within today's feed or among search-only rows from
the same refresh quarantine the entire stock. Conflicting VIN identities or
yards are also quarantined, and their valid observed VINs remain preservation
evidence. Repeated stocks inside one response and benign duplicate VINs count
toward the unchanged 25% duplicate guard. Rejected repeats remain rejects rather
than benign duplicates. Rejects remain inside the 10% rejection guard with no intentional exclusions.

Each yard must retain at least 50% of its previous published count and meet its
floor: Waco 428, Bryan 322, Beaumont 357, Port Allen 345 and Jackson 323.
The source floor is 1,775, and durable validation also checks source-wide drift.
No vehicle or yard callback occurs until the complete daily slice validates.

The November 15, 2026 feeds contain Waco 1,220, Bryan 967, Beaumont 1,083,
Port Allen 1,038 and Jackson 973 observations, or 5,281 total. Strict feed-only
validation accepts 1,219, 967, 1,073, 1,036 and 969 respectively: 5,264 unique
donors, 16 rejects and one duplicate. These are photographed-feed baselines,
not claims that the other four yards received a complete live search sweep.

The Waco-only full sweep visited all 1,338 controls and found 1,283 unique search
stocks. Together with three feed-only stocks, the union contains 1,286 stocks,
including 66 unphotographed stocks absent from arrivals. Strict validation
accepts 1,285 Waco donors. Both STK044158 and STK044160, all 17 prior missing
Waco controls, and the Jeep corrections are present in the saved responses.
Opening and closing Waco feeds contain the same 1,220 stocks.

The saved five-yard union accepts 5,330 donors, with 16 rejects and one duplicate
among 5,347 logical stock observations. No full live search sweep was run for
the other four yards. Qualification made 1,350 recorded GETs: 1,338 Waco
searches, six feed reads, one 1955 Jeep directory read and five location pages.
All returned HTTP 200. The shortest interval between recorded search response
completions was 2,352 ms. The complete Brotli archive replays offline and checks
every native query exactly once.

## Operation

The source runs by default. The `ingestion-source-byot` flag pauses it when it serves false. Qualification did not change production flags or publish inventory.

Count-only daily soak:

```sh
bun run soak:sources -- --sources=byot --max-pages=965
```

The standalone soak never reads production cursor history or writes canonical
inventory. Its helper supports an injected runner with a previous terminal
cursor for multi-day offline replay. Tests use saved responses and HTTP stubs,
never the network.

For a directory refresh, capture the site's `/search/makes?year=YYYY` and
`/search/models?make=MAKE&year=YYYY` lists, preserving older aliases and Jeep
controls. Yearless directory requests are not supported reliably. Rebuild from
an expanded saved archive using:

```sh
bun scripts/refresh-byot-directory.ts saved-native-controls.json.br
```

Requalify directory changes before rollout. Finish or discard active runs
before changing their directory. The next run can load a completed cursor from
the prior directory: matching query buckets survive, the sweep restarts at the
first query, and removed queries retain their buckets only until the 21-day
expiry. Checkpoints retain query identities and their directory, so reordering
queries cannot associate old results with a different make/model. Do not
silently drop native controls to retain an old cursor.

On a request, parser, checkpoint or guard failure, the previous published
inventory remains intact. Inspect the named operation and saved response,
respect Retry-After, and resume the last validated checkpoint only within its
daily deadline. Do not force reconciliation from an incomplete daily slice.
