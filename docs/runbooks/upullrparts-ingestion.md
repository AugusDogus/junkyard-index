# U Pull R Parts ingestion

Source: `upullrparts`. Three verified stores: Rosemount MN (1), East Bethel MN
(2), and Toledo OH (3). No provider credentials are required.
See [provider photos and inventory links](provider-media-links.md) for media
validation and the manual-search destination contract.

## Public API

POST `https://upullrparts.com/wp-admin/admin-ajax.php`, URL-encoded, with
`action=doAaaApiCall` and `User-Agent: JunkyardIndex/1.0`. The old shared Chrome
user-agent received HTTP 403 during verification. The
[public inventory form](https://upullrparts.com/inventory/) and its
`wp-content/plugins/V5.0/vehicle-search.js` script define these requests.

| `apiAction`        | Fields                                                                                                | Token |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ----- |
| `getMakes`         | None                                                                                                  | No    |
| `getModels`        | `Make=<raw label>&ModelYear=0`                                                                        | No    |
| `getVehicles`      | `site`, `makes` (`""` or `0` is any), `models=0`, `years=0`, `beginDate`, `endDate`, `turnstileToken` | Yes   |
| `getVehicleImages` | `stockID=<stock>`                                                                                     | No    |

Parameter case matters. Preserve raw make and model labels in requests,
including trailing whitespace. Responses are bare JSON arrays. HTTP 206,
Content-Range, or Link headers fail the chunk.

`getVehicles` locations are `1` (Minnesota, stores 1 and 2) and `3` (Toledo);
one search covers one location, and rows carry no make. Verified by a live
probe on November 24, 2026:

- `beginDate` and `endDate` are inclusive `YYYY-MM-DD` days filtering
  `DateSetData`, the day a vehicle was set out (its arrival). Either may be
  empty to leave that side open. Dates and `makes` combine with AND.
- A search returns at most 100 rows, with no paging. Over 100 matches it
  returns the **newest 100 by date, ordered by store rather than strictly by
  date**, so a full result is never used: it only tells the crawl where to
  split.
- Every stored row has a date (the oldest is 2020-09-03). Vehicles are set out
  Monday to Friday only, at most 64 on one day at one location.

It needs a Cloudflare Turnstile token (site key in the page's `UPULL`
object, action `getVehicles`):

- No token: HTTP 403 `captcha_missing`.
- An invalid, reused or expired token: HTTP 200 with `[]`.
- A valid token works from any IP, not only the browser that solved it. Each
  verifies once; tokens are valid for 300 seconds.

### Per-IP block

Measured November 23 from fresh Vercel Sandbox IPs and a residential IP: an
IP that sends more than about 13 `getVehicles` searches within a minute gets
`[]` for every search afterwards, with HTTP 200, while the same tokens still
work from another IP. The block still held 3.5 hours later on the residential IP.
Searches every 12 s (36 in a row), 7 s (40) and 5 s (40) passed; one about
every 4.3 s tripped it at the 14th. Token-free actions (40 photo lookups at 8
at a time, plus `getModels`) do not count toward it.

This is why every run from November 12 to 23 was rejected. The old Vercel
Sandbox search server ran three browser tabs at once, so each chunk reached
the limit about 14 searches in: the canary, the Chevrolet make search and
its first dozen models. The next model, `CAPTIVA SPORT`, then came back
empty and failed the coverage check. Tokens were never being rejected.

## Turnstile tokens

A Kernel browser opens two inventory tabs, one after the other, that click the
widget and read `getTurnstileToken()`. Its profile (`KERNEL_BROWSER_PROFILES`
in `kernel-sessions.ts`) is headful on Kernel's stealth proxy; every other
Kernel source runs headless with direct egress
([browser providers](browser-providers.md)):

- Headful, because in a headless stealth browser the widget crashes
  (Cloudflare error `300031`) in most tabs and issues no token.
- Stealth proxy, because 32 tokens took 48 to 72 browser-seconds through it
  and 124 with direct egress, with the same 195 vehicles either way.
- Two tabs, because billing is per browser-second and more tabs did not mint
  faster (about 0.40 tokens a second on 2, 0.365 on 4). On 6, the site served
  its SiteGround robot check (`/.well-known/sgcaptcha`) to the proxy IP and the
  tabs never loaded.

The browser takes the source's place in the `kernel` lease group and opens on
the chunk's first search. It mints the chunk's tokens ahead of use, then is
deleted, usually within about 75 s; searches spend them from the Vercel
function as they come. Tokens older than 270 s are dropped. A search that
fails in transit is sent once more with another token; a token is never
resent. A create that Kernel refuses for its plan, capacity or credit defers
the chunk, as for every Kernel source, and so does a create once the source's
daily or monthly Kernel cap is spent ([Kernel spend](#kernel-spend)). The
browser mints only the tokens the chunk's plan needs (see below). The pacing
slot is taken only once the search's token is in hand, so a slow token never
lets two searches go out back to back; a transit retry takes a new token and
a new slot.

## Crawl

The whole inventory is crawled every day, by arrival date
(`upullrparts-date-crawl.ts`). Until November 24 it walked every make, model
and year, about 860 searches and tokens a crawl; the date crawl needs about 60.

1. **Directory chunk.** The run's first chunk loads `getMakes` and every
   make's `getModels` (about 60 requests, 1.5 s apart, no token and no
   browser) and stores them with its checkpoint (`checkpointState`; the
   cursor's `statePath` names it), so crawl chunks spend none of their work
   limit on the directory. It also sets the run's end date, `today`, the UTC
   day (never earlier than a yard's local day).
2. **Plan.** Each crawl chunk reads yesterday's published snapshot (every
   stored U Pull R Parts vehicle, `upullrparts-history.ts`) and plans its
   location's windows from its cursor's `end` back to 2000-01-01: consecutive
   days packed while their live vehicles stay within about **90**, every day
   in exactly one window, the newest ending explicitly at `today` and the
   oldest starting at 2000-01-01. A business day on or after the snapshot's
   publication day, which the snapshot may not have seen in full (today, and
   every day since a stale snapshot), expects the location's busiest snapshot
   day, so today gets a window of its own. The plan only sets cost: a window
   that comes back full is split.
3. **Windows**, newest first, one location per chunk:
   - Fewer than 100 rows: accepted.
   - 100 rows over several days: never used. The window is split after the
     oldest day in those rows (they are the newest 100, so the newer part
     holds fewer than 100) and both parts are searched. The first run after
     the stale November 11 snapshot splits its large windows this way.
   - 100 rows on one day: the chunk stops there and the next chunk searches
     that day make by make, in label order, resumably (`split` cursor). Every
     row of the full search must turn up under some make (coverage check),
     and a make that still returns 100 fails the chunk. No day has come close:
     the most seen is 64. Known limit of this never-used path: most makes
     have no arrivals on a given day, so an empty make search is accepted
     without a canary (one per make would cost about 56 more searches). A
     rejected token there can only drop vehicles missing from the full
     search's 100 rows; one among them fails the coverage check, and since a
     retry resumes after the last finished make, the next scheduled run
     splits the day again from its first make.
   - `[]`: may be a single rejected token (also `[]`, with no block) or a
     blocked IP, so the Ford canary runs and the window is searched exactly
     once more before it is accepted as empty, as it can be early on a
     business day. This includes today's window, which yesterday's snapshot
     cannot predict.
4. **Makes.** Date rows carry no make. In order: the stored make of a VIN the
   snapshot knows; the one canonical make whose `getModels` lists the model
   (spellings of one make, such as `FORD` and `Ford`, count once); for a model
   two makes list (the directory has collisions such as `MUSTANG` and
   `FORD E250 VAN`), one search of its arrival day and each candidate make;
   then a vPIC VIN decode (20 s at most). A vehicle none of these resolve is
   listed under Other with a warning naming its VIN and model, never silently.
5. **Photos.** A known VIN with the same stock and a stored photo keeps it;
   only new stock, and known stock with no photo, is looked up.

A Ford search with open dates, before and after each chunk's searches, must
return vehicles, since a blocked IP gets `[]` for every search. An empty
canary is searched once more with a fresh token, since one rejected token
returns `[]` too. When both are empty (before, after, or for an empty window)
the chunk emits nothing and pauses at
its cursor with `blockedSince` and a `retryAt` 45 minutes later; the workflow
sleeps until then. A block lasts over an hour and each retry opens a billed
session for its canary token, so retries are not sent every few minutes. The
run fails once the next retry would start more than three hours after the
first empty canary, after at most four sessions; prior inventory is kept. A
chunk whose canaries pass clears the block.

On November 1 to 3 a production date crawl that paged by `endDate` was
accepted (3,330 and 3,331 vehicles); it later broke by treating an empty page
as the end of the list. The window crawl never reads an empty result as an
end: the windows run to 2000-01-01 regardless, and an empty window is
canaried and searched again.

## Vehicle photos and outbound links

The catalog has no photo fields. After make resolution, for new stock and known
stock without a photo only, POST to the same endpoint
with `action=doAaaApiCall&apiAction=getVehicleImages&stockID=<stock>` and the same
user-agent. Deduplicate by usable stock. Success is an object with `success: 1`
and `images: [{ fileName, url }]`; a successful empty list or missing local stock
retains null. Failed or malformed lookups abort before yard/vehicle callbacks.

Use only returned `api.aaaparts.com/staticImages` URLs whose filenames match the
stock, preferring photo order `6, 3, 4, 1, 5, 2`. Filenames include timestamps;
do not construct them or substitute the separate full-service parts-photo URLs.
`detailsUrl` is null: the public form does not restore results from query parameters.
Cards and alerts offer **Search provider inventory** with VIN/yard instructions;
cards also provide **Copy VIN**.

## Checkpoints and execution budget

- Cursor phases: `directory` (the first chunk), `crawl` (`location`, `end`:
  every arrival after it, up to `today`, was accepted), `split` (`location`,
  `day`, `afterMake`, and `missing`: the full search's rows no make has
  returned yet, at most 100), and `complete`. Searching cursors also carry
  `today`, `statePath` (the stored directory) and the block fields.
  `storesSeen` accumulates stores with usable vehicles; the final chunk fails
  if a known yard never reported one.
- A chunk covers one location, since the canaries are per location. It sends
  at most **32** searches, both canaries included, starts them no more often
  than every **7.5 s** (8 a minute, under the block at about 13), and mints
  tokens for its plan, not a fixed count: one per planned window, 4 for both
  canaries with a retry each, 3 for one empty window's canary (retried) and
  re-search, at most 32, plus 2 for transit retries. Tokens it does not need
  for those go to day and make searches and to splitting full windows. A
  split chunk mints for its remaining makes and both canaries.
- It stops starting windows 200 s after its opening canary, once less than
  90 s of its work limit would be left (as after a slow session open), or
  when a window and the closing canary would pass its search budget. An empty
  window whose canary and re-search no longer fit is left unaccepted: the
  chunk pauses at it and the next chunk searches it again. Its work limit is
  five minutes; waiting for the session lease does not count.
- Windows are disjoint, so no vehicle is emitted by two chunks. Vehicles,
  photos and yards are emitted only after the closing canary and photos
  succeed. Callback batches hold at most 250 vehicles.
- Directory requests (`getMakes`, `getModels`) start at most once every
  1.5 s, with two retries. Photo lookups use at most 8 concurrent requests and
  share three attempts with 1 s then 2 s backoff.
- Shared acceptance requires at least 2,000 vehicles and applies previous-run
  drift, rejection, and duplicate checks. Unknown yard IDs produce warnings and
  observed VINs.

### November 24 date-crawl soak

A full read-only soak of the date crawl, planned from the production snapshot
(the stale November 11 publication, so every business day since was
estimated), on the test Kernel key, completed with all three stores: **3,353
vehicles** (UPRRP-1 1,308, UPRRP-2 1,141, UPRRP-3 904), with no
rejected, duplicate or unknown-yard rows and none listed under Other (the
November 11 accepted run had 3,334).

| Chunk | Location  | Searches | Vehicles | Seconds |
| ----- | --------- | -------: | -------: | ------: |
| 1     | directory |        0 |        0 |      85 |
| 2     | 1         |       31 |    1,578 |     276 |
| 3     | 1         |       24 |      871 |     188 |
| 4     | 3         |       19 |      904 |     167 |

**74 searches** in 3 search chunks, against about 860 for the make walk. The
directory chunk sent 57 token-free requests and opened no browser. Chunk 2
could not fit two day and make searches, so two vehicles' makes came from the
VIN decode.

The workstation's own IP was blocked by getVehicles (two canaries with fresh
tokens came back empty, likely since the November 23 measurements), so this
soak sent each search from inside the Kernel browser that minted its token
(`UPULLRPARTS_SOAK_SEARCHES=browser`), from its stealth-proxy IP. Every other
part of the crawl ran as in production, but each browser stayed open for its
whole chunk: 3 browsers, **630.7 headful seconds, $0.084**, all deleted. In
production a browser is open only while it mints: 34, 31 and 24 tokens at
about 0.40 a second on 2 tabs is about 220 s plus three opens, about **$0.03**
for this stale-snapshot day. A day after a fresh publication plans about 55
windows (about 60 searches) and costs about $0.02 to $0.03.

### November 23 make-walk measurement

The make walk this crawl replaced. A full read-only crawl from fresh Vercel
Sandbox IPs, resumed twice from its
durable cursor, completed with all three stores: **3,343 vehicles** (Minnesota
2,444, Toledo 899) in 27 chunks of about 230 s and 26 searches each, with no
rejected, duplicate or unknown-yard rows (the November 11 accepted run had
3,334). Its tokens came from Hyperbrowser, whose sessions lasted about 97 s a
chunk; a crawl took about 105 minutes of chunk time, before lease waits. The
session lease is held only while a chunk mints, so other sources on the same
provider run between chunks.

The first chunk was then run on Kernel (headful, two tabs) from fresh Sandbox
IPs, through the connector's default, with Kernel's own `usage.uptime_ms`:

| Egress        | Browser-seconds | Cost at $0.0001333/s | Result                                 |
| ------------- | --------------: | -------------------: | -------------------------------------- |
| Stealth proxy |    47.9 to 72.4 |   $0.0064 to $0.0097 | 26 searches, 195 vehicles, split pause |
| Direct        |           123.6 |              $0.0165 | the same                               |

At 27 chunks a crawl costs about **$0.17 to $0.26** on the stealth proxy. One
more run, started three minutes after another from the same AWS range, had its
opening canary come back empty; it paused for 45 minutes after 6.4
browser-seconds and emitted nothing.

A separate Toledo rerun from another sandbox IP, started while that crawl
still ran from the same AWS range, had its closing canary come back empty in
its eighth chunk, about 210 searches and 31 minutes in. The chunk emitted
nothing. Single crawls sent about 215 searches per 30 minutes without a block,
so the limit may also count a wider range than one IP; run one crawl at a
time.

Not measured: the production path. Every search above, and in the November
24 soak, was sent from a Vercel Sandbox IP or a Kernel browser by a harness.
Searches sent from a Vercel Function's egress IP, the session lease
taken under the 07:00 contention, and whether a function's IP
changes between block retries have not been run. Tokens are known to work
from local, Sandbox, Hyperbrowser and Kernel IPs. If Function IPs share the
wider AWS limit above, expect block pauses; each costs one short browser.

## Schedule

U Pull R Parts is checked and published **every day**, like every active
source, with the usual three scheduled attempts a day. It goes stale after
the shared 36 hours (`SOURCE_STALE_AFTER_HOURS`), and its yards follow the
same three-day inventory date as every other source. Cost is cut by crawling
smarter, not less often: a day's crawl is about 60 searches in 3 search chunks
and the directory chunk, which opens no browser, about $0.02 to $0.03 of Kernel
time (74 searches and about $0.03 after the stale November 11 snapshot,
measured above).

### Kernel spend

Kernel's Developer plan has $5 of credit a month, shared with every Kernel
source (Big D, Northwest, Vander Haags and U Pull It Davie, about $0.94 a
month together, and 603, metered against its own cap of $0.60 a month; see
[browser providers](browser-providers.md#metered-sources)). When it is used
up Kernel refuses every browser with HTTP 403, so all of them stop.

- Every U Pull R Parts browser is recorded in `kernel_browser_usage` (from
  before its create to its delete; one never closed counts its longest
  possible life, 420 s), at $0.0001333 a headful second.
- Two caps in `kernel-usage.ts`, checked when a crawl chunk starts (before it
  reads the snapshot) and again before every create; reaching either defers
  the chunk without opening a browser, with a message naming the cap, the
  spend and when it resets:
  - **$0.25 a UTC day** (`KERNEL_DAILY_BUDGET_USD`), about ten healthy
    crawls, so a day of failing retries stops long before it can eat the
    month. It resets at 00:00 UTC.
  - **$1.80 a UTC month** (`KERNEL_MONTHLY_BUDGET_USD`; $3.50 until November 24, 2026, when 603 took its own caps, and $3.30 until November 25, when City Motors took its own), so the other Kernel
    sources keep the rest of the credit. It resets on the 1st.

  A deferral fails its run after three hours, as any deferral does, so the
  source shows as failing until the cap resets.

- Worst cases, at $0.0001333 per headful second:

  | Case                                              | Cost                                  |
  | ------------------------------------------------- | ------------------------------------- |
  | One browser, at most (360 s chunk + 60 s timeout) | $0.056                                |
  | A healthy day (3 search chunks, measured below)   | about $0.02 to $0.03                  |
  | A healthy month (30 or 31 days)                   | about $0.60 to $0.95                  |
  | Any day, with the daily cap                       | $0.25 plus at most one browser: $0.31 |
  | A month that fails every day, with both caps      | $1.80 plus at most one browser: $1.86 |

- To check spend: `select sum((coalesce(ended_at, started_at + 420000) - started_at) / 1000.0) * 0.0001333 from kernel_browser_usage where source = 'upullrparts' and started_at >= <start of the day or month, ms>`.
  The caps count only production's browsers; a local soak records its own in
  a temporary database.
- After the first production crawl on Kernel, compare the Kernel dashboard's
  charge for that day with the browser-seconds above to confirm the stealth
  proxy has no separate charge. If it does, add it to `KERNEL_USD_PER_SECOND`.

## Yard metadata

Addresses and phones come from the [public contact page](https://upullrparts.com/contact/);
coordinates are public map pins, not city/ZIP centroids. The Rosemount page body
lists 2871, while its footer and named business map pin agree on **2985 160th St W**;
the configured metadata uses 2985. Metadata is in `upullrparts-yard-metadata.ts`.
The shared contact page is not published as a yard-specific website.

## Local verification

```sh
KERNEL_API_KEY=... UPULLRPARTS_HISTORY_DATABASE_URL=... UPULLRPARTS_HISTORY_AUTH_TOKEN=... \
  SKIP_ENV_VALIDATION=1 bun run soak:sources -- --sources=upullrparts --cycles=1
bun test src/server/ingestion/upullrparts
```

Use the test Kernel key, never production's. The two history variables point
at a database whose published snapshot plans the windows, such as
production's; it is only read. Without them the soak plans with no snapshot
and finds its windows by splitting, which costs more searches. The soak runs
every chunk, round-trips each cursor, keeps the directory chunk's state in
memory, prints the Kernel browser-seconds and cost it metered, and counts and
discards inventory. It does not publish database changes, Algolia records, or
notifications. It opens one billed headful Kernel browser per chunk and takes
no lease. Run it from an IP that has not just tripped the per-IP block: when a
canary comes back empty the soak stops and prints the cursor to resume from,
instead of opening more browsers. It still waits and retries when Kernel
refuses a browser at the plan's concurrent limit. Delete any browser a stopped
soak leaves ([browser providers](browser-providers.md)).
