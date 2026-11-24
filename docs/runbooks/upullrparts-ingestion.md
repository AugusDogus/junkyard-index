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

| `apiAction`        | Fields                                                                                   | Token |
| ------------------ | ---------------------------------------------------------------------------------------- | ----- |
| `getMakes`         | None                                                                                     | No    |
| `getModels`        | `Make=<raw label>&ModelYear=0`                                                           | No    |
| `getYears`         | `Make=<raw label>&Model=<raw label>`                                                     | No    |
| `getVehicles`      | `site`, `makes`, `models`, `years` (`0` is any), `beginDate=&endDate=`, `turnstileToken` | Yes   |
| `getVehicleImages` | `stockID=<stock>`                                                                        | No    |

Parameter case matters. Preserve raw make and model labels in requests,
including trailing whitespace. Responses are bare JSON arrays. HTTP 206,
Content-Range, or Link headers fail the chunk.

`getVehicles` locations are `1` (Minnesota, stores 1 and 2) and `3` (Toledo).
It returns at most 100 rows, newest first, with no paging, and rows carry no
make. It needs a Cloudflare Turnstile token (site key in the page's `UPULL`
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
- Stealth proxy, because one chunk's 32 tokens took 48 to 72 browser-seconds
  through it and 124 with direct egress, with the same 195 vehicles either way.
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
monthly Kernel budget is spent ([Kernel spend](#kernel-spend)). The pacing
slot is taken only once the search's token is in hand, so a slow token never
lets two searches go out back to back; a transit retry takes a new token and
a new slot.

## Crawl

For each location, makes are crawled in label order. A make search with fewer
than 100 rows is complete. A full one is split by every `getModels` label plus
any model in its rows, in label order; a full model is split by `getYears`
plus any four-digit year in its rows. Every vehicle in a full page must
reappear in its split search; a split that drops one is searched again, up to
three times, and then fails the make. An empty make is searched twice.

A Ford search before and after each chunk's crawl must return vehicles, since
a blocked IP gets `[]` for every search. When either is empty the chunk emits
nothing and pauses at its cursor with `blockedSince` and a `retryAt` 45
minutes later; the workflow sleeps until then. A block lasts over an hour and
each retry opens a billed session for its canary token, so retries are not
sent every few minutes. The run fails once the next retry would start more
than three hours after the first empty canary, after at most four sessions;
prior inventory is kept. A chunk whose canaries pass clears the block.

A split search that still drops a known vehicle after three attempts fails the
chunk with the coverage error. The workflow step retries it from the same
cursor, and under a block that retry's opening canary comes back empty and
pauses as above. The canaries catch a blocked IP, not a single rejected
token: if one search's token were rejected, a model whose rows were not in its
make's first 100 would read as having no stock for that run. No rejected
token has been seen since tokens were spent once each, fresh.

## Vehicle photos and outbound links

The catalog has no photo fields. After make resolution, POST to the same endpoint
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

- Cursor phases: `crawl` (`location`, `afterMake`), `split` (`location`,
  `make`, `model`, `year`: resume a full make after that model, or after that
  year of it), and `complete`. `storesSeen` accumulates stores with usable
  vehicles; the final chunk fails if a known yard never reported one.
- A chunk sends at most **30** searches, both canaries included, starts them
  no more often than every **7.5 s**, and mints 32 tokens (two spare for
  transit retries). It stops starting crawl steps 200 s after its opening
  canary, or once less than 60 s of its work limit would be left (as after a
  slow session open), or when a whole step (up to three searches) and the
  closing canary would pass the search limit, and can pause inside a split
  make. Its work limit is five minutes; waiting for the session lease does
  not count.
- A resumed split make repeats its make search for the coverage check and
  emits only vehicles of models (or years) past the cursor, even when the
  make or model is no longer full, so no vehicle is emitted by two chunks.
- Vehicles, photos and yards are emitted only after the closing canary and
  photos succeed. Callback batches hold at most 250 vehicles.
- Directory requests (`getMakes`, `getModels`, `getYears`) start at most once
  every 1.5 s, with two retries. Photo lookups use at most 8 concurrent
  requests and share three attempts with 1 s then 2 s backoff.
- Shared acceptance requires at least 2,000 vehicles and applies previous-run
  drift, rejection, and duplicate checks. Unknown yard IDs produce warnings and
  observed VINs.

### November 23 measurement

A full read-only crawl from fresh Vercel Sandbox IPs, resumed twice from its
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
| Stealth proxy |       47.9–72.4 |      $0.0064–$0.0097 | 26 searches, 195 vehicles, split pause |
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

Not measured: the production path. Every search above was sent from a
Vercel Sandbox IP by a harness, and the crawl was stitched from three
resumes. Searches sent from a Vercel Function's egress IP, the session lease
taken through Redis under the 07:00 contention, and whether a function's IP
changes between block retries have not been run. Tokens are known to work
from local, Sandbox, Hyperbrowser and Kernel IPs. If Function IPs share the
wider AWS limit above, expect block pauses; each costs one short browser.

## Schedule

U Pull R Parts is crawled **every third ingestion day**, not daily
(`INGESTION_SOURCE_CADENCES` in
[`ingestion-source.ts`](../../src/lib/ingestion-source.ts)). Each crawl mints
about 860 Turnstile tokens in a headful Kernel browser, about $0.17 to $0.26
(measured above), so a daily crawl would cost about $5 to $8 a month; every
third day costs about $1.70 to $2.60, which keeps it with Big D and Northwest
inside Kernel's $5 monthly credit.

- The daily wakeup skips the source until three ingestion days (07:00 UTC
  boundaries) have passed since the ingestion day its last accepted run
  started on (`schedule_key`), not the day it published, so a run that
  publishes after the next 07:00 boundary does not trigger an extra crawl. A
  resting source does not hold the day's pass open.
- It gets **one** scheduled attempt a day
  (`INGESTION_SOURCE_MAX_ATTEMPTS_PER_DAY`), not three. After a crawl day with
  no accepted run it rests one day, then retries; so a source that keeps
  failing is attempted every other day.
- `/api/status`, `/api/status/upullrparts` and `/admin` call it stale 84 hours
  (its cadence plus 12 hours) after its last accepted publication, instead of 36. Admin shows "Resting, next crawl <day>" on its rest days.
- Its yards keep their inventory date on the site for 5 days (cadence plus 2)
  after the last accepted publication, so they stay listed between crawls and
  through one missed crawl. Their yard pages warn "Not updated in the last 5
  days" only past that.
- Better Stack: `/api/status/upullrparts` already uses the 84-hour threshold.
  If `BETTERSTACK_PROVIDERS` gives `upullrparts` a `heartbeatUrl` (the value
  is a sensitive Vercel variable and cannot be pulled), set that heartbeat's
  period in Better Stack to 3 days with 12 hours of grace; a daily period
  would turn its status row red on every rest day.
- A sold vehicle is marked missing by the first crawl that does not see it and
  deleted by a later one, so it can stay listed for up to about six days.
- A manual run from `/admin` still starts it on any day.

### Kernel spend

Kernel's Developer plan has $5 of credit a month, shared with Big D and
Northwest (about $0.66 a month together). When it is used up Kernel refuses
every browser with HTTP 403, so all three sources stop.

- Every U Pull R Parts browser is recorded in `kernel_browser_usage` (from
  before its create to its delete; one never closed counts its longest
  possible life, 420 s). Once the month's spend (UTC calendar month, headful
  seconds at $0.0001333) reaches **$3.50** (`KERNEL_MONTHLY_BUDGET_USD` in
  `kernel-usage.ts`), its chunks defer without opening a browser until the
  1st of the next month, with a message naming the spend. The deferral fails
  each run after three hours, as any deferral does, so the source shows as
  failing until then while Big D and Northwest keep the rest of the credit.
- Worst cases, at $0.0001333 per headful second:

  | Case                                                                                      | Cost                                  |
  | ----------------------------------------------------------------------------------------- | ------------------------------------- |
  | One browser, at most (360 s chunk + 60 s timeout)                                         | $0.056                                |
  | A healthy crawl (27 chunks, 48 to 72 s each)                                              | $0.17 to $0.26                        |
  | A healthy month (10 or 11 crawls)                                                         | $1.70 to $2.86                        |
  | A failing attempt (a full crawl, then its last chunk failing 3 step retries at the limit) | about $0.43                           |
  | A month that fails every attempt (16 attempts, every other day), uncapped                 | about $6.90                           |
  | Any month, with the guard                                                                 | $3.50 plus at most one browser: $3.56 |

  Before this guard a failing day cost about $0.40 to $1.10 (three runs, each
  failing chunk retried three times), so twelve failing days could spend the
  whole credit.

- To check a month's spend: `select sum((coalesce(ended_at, started_at + 420000) - started_at) / 1000.0) * 0.0001333 from kernel_browser_usage where source = 'upullrparts' and started_at >= <first of month, ms>`.
  The guard counts only production's browsers; a local soak records its own in
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
KERNEL_API_KEY=... bun run soak:sources -- --sources=upullrparts --cycles=1
bun test src/server/ingestion/upullrparts
```

The soak runs every chunk, round-trips each cursor, and counts and discards
inventory. It does not publish database changes, Algolia records, or
notifications. It opens one billed headful Kernel browser per chunk and takes
no lease. Run it from an IP that has not just tripped the per-IP block: when a
canary comes back empty the soak stops and prints the cursor to resume from,
instead of opening more browsers. It still waits and retries when Kernel
refuses a browser at the plan's concurrent limit. Delete any browser a stopped
soak leaves ([browser providers](browser-providers.md)).
