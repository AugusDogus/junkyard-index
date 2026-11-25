# Browser providers

Sources whose sites refuse the deployment's egress read their documents
through a remote browser. Kernel (kernel.sh) is the long-term provider.
Hyperbrowser's free credits were a one-time grant and will run out, so every
live browser source opens Kernel browsers since November 23, 2026, 603
since November 24 and City Motors since November 25. Only the retired Michigan Truck is still set to
Hyperbrowser, and it stays available as a one-line fallback for any source.

| Provider     | Sessions module                                 | Key                               | Concurrency                                           | Lease group    |
| ------------ | ----------------------------------------------- | --------------------------------- | ----------------------------------------------------- | -------------- |
| Kernel       | `src/server/ingestion/kernel-sessions.ts`       | `KERNEL_API_KEY` (optional)       | `KERNEL_CONCURRENT_SESSIONS` (unset: 5, Developer)    | `kernel`       |
| Hyperbrowser | `src/server/ingestion/hyperbrowser-sessions.ts` | `HYPERBROWSER_API_KEY` (required) | `HYPERBROWSER_CONCURRENT_SESSIONS` constant (1, Free) | `hyperbrowser` |

Each provider has its own account, concurrent session limit and lane group in
the session lease, so a busy Hyperbrowser plan never holds back a Kernel
source and the reverse. Both follow the same [lease](hyperbrowser-sessions.md#session-lease)
and [lock order](hyperbrowser-sessions.md#lock-order) rules and share the page
preparation, transport modes and subresource routing in
`document-transport.ts`. `src/env.js` validates `KERNEL_CONCURRENT_SESSIONS`,
so a value that is not a whole number from 1 to 999 fails the build.

## Who uses which

All sources are chosen in `BROWSER_PROVIDERS` in `browser-providers.ts`. U
Pull R Parts' Kernel browsers are headful on the stealth proxy. U Pull R
Parts, 603 and City Motors are [metered](#metered-sources) against their own
daily and monthly Kernel caps; moved to Hyperbrowser, they would run without
those caps.

| Source               | Page driven by                                    | Provider                                |
| -------------------- | ------------------------------------------------- | --------------------------------------- |
| Big D                | `DocumentTransport` (navigation)                  | Kernel                                  |
| Northwest            | `DocumentTransport` (fetch)                       | Kernel                                  |
| Vander Haags         | `vanderhaags-browser-session.ts`                  | Kernel                                  |
| U Pull It Davie      | `upullit-davie-browser-session.ts`                | Kernel                                  |
| 603 Auto Salvage     | `DocumentTransport` (navigation, then fetch)      | Kernel, metered                         |
| City Motors          | `DocumentTransport` (edge landing, then fetch)    | Kernel, metered                         |
| Michigan Truck Parts | `DocumentTransport` (retired: paused and hidden)  | Hyperbrowser                            |
| U Pull R Parts       | its Turnstile minter (`upullrparts-turnstile.ts`) | Kernel, headful, stealth proxy, metered |

The choice is typed (`BrowserProvider = "hyperbrowser" | "kernel"`) and is not
part of any cursor scope, so moving a source keeps in-flight checkpoints and
accepted history. Vander Haags and U Pull It Davie drive their own page (a
rendered WAF navigation and in-page fetch, or an in-page JSON API), so they
take only the session lifecycle: `DocumentTransport.sourceBrowsers(source,
config)` gives the chosen provider's lease, create and stop, and
`DocumentTransport.acquireSession` takes the lease, then starts the session
with the same refusal classification and stop-on-close as the transport,
logging its id at info level. Their pages are not
routed, so they load every subresource as before. URG IIS reads natively: the
Cloudflare-blocked tenants were cut instead ([URG IIS](urgiis-ingestion.md)).

`@hyperbrowser/sdk`, `HYPERBROWSER_API_KEY` (still required by `src/env.js`),
`hyperbrowser-sessions.ts`, the Hyperbrowser half of `document-transport.ts`
and the admin Hyperbrowser budget page remain for the fallback and the
retired Michigan Truck; no live source is configured to use them.

## Moving a source, or falling back

1. Change the source's value in `BROWSER_PROVIDERS` and the pinned map in
   `browser-providers.test.ts`. Falling back to Hyperbrowser is the same
   one-line change in the other direction, for Vander Haags and U Pull It
   Davie too (stealth, accepted cookies, `us-west`, no proxy, no CAPTCHA
   solving).
2. Make sure the provider's key is set in Vercel (Production and Preview). A
   source on Kernel without `KERNEL_API_KEY` never falls back on its own: its
   browser open fails with "KERNEL_API_KEY is not set, but <source> is
   configured to open Kernel browser sessions", no request is sent and prior
   inventory is preserved.
3. Soak it locally with the provider's key, count only:
   `bun run soak:sources -- --sources=<source>`. The soak refuses to start
   without the key its sources need. Delete any browser a stopped soak leaves
   (below). The generic Vander Haags soak starts with no previous census, so
   it is a cold census (about 177 browsers, about 3.9 browser-hours at 79 seconds each); to match a
   production day, pass the last accepted terminal cursor as `previousCursor`
   to the first checkpoint, with `source: "vanderhaags"` added as
   `loadVanderHaagsPublishedCursor` does, and start it after 00:00 UTC, since
   a run stops at the UTC day boundary.

## Kernel sessions

- Each chunk creates one browser with `POST https://api.onkernel.com/browsers`
  `{"stealth": true, "headless": true, "timeout_seconds": 60, "proxy": {"mode": "direct"}}`
  (the default profile in `kernel-sessions.ts`),
  connects over CDP with `playwright-core` and deletes it with
  `DELETE /browsers/{id}` when the chunk ends, on success, failure or
  interruption. A failed connect deletes its browser before the next attempt
  creates another. A 404 on delete counts as already deleted. A browser whose
  delete fails is deleted by Kernel 60 seconds after its CDP connection
  closes; the lease outlasts that, so the next holder does not hit the plan
  limit.
- Egress is direct, as Hyperbrowser ran. `stealth` alone also routes through
  Kernel's default stealth proxy; on November 23, 2026 that proxy returned an
  HTTP 502 and an in-page "network error" on Northwest in two of two soaks,
  while direct egress read the whole catalog. `stealth` still enables the
  CAPTCHA solver.
- A source can have its own typed profile (`KERNEL_BROWSER_PROFILES`: mode
  `headless | headful`, egress `direct | stealthProxy`). Only U Pull R Parts
  has one: headful, because its Turnstile widget crashes headless, and on the
  stealth proxy (no `proxy` field), because tokens minted there in about half
  the browser-seconds of direct egress
  ([U Pull R Parts](upullrparts-ingestion.md#turnstile-tokens)).
- Billing is per second of browser uptime ($0.0000166667 per headless
  second, about $0.06 an hour; $0.0001333 per headful second, about $0.48 an
  hour), with no minimum. The Developer plan is free
  with $5 of usage credit a month and 5 concurrent browsers.
- Refusals on create defer the chunk instead of failing it:

  | Kernel answer on create                                     | Result                                                   |
  | ----------------------------------------------------------- | -------------------------------------------------------- |
  | HTTP 429 `org_limit_exceeded` (concurrent browsers full)    | `ProviderCapacityDeferred`: the chunk retries its cursor |
  | HTTP 429 other (create rate limit)                          | `ProviderCapacityDeferred`                               |
  | HTTP 529 (Kernel out of capacity)                           | `ProviderCapacityDeferred`                               |
  | HTTP 403 (spending cap, monthly credit used up, plan limit) | `ProviderCapacityDeferred`                               |
  | none sent: a metered source's daily or monthly cap is spent | `ProviderCapacityDeferred`, until the cap resets         |
  | HTTP 401, other 4xx, 5xx, missing `KERNEL_API_KEY`          | the read fails with the provider's message               |

  A deferred chunk retries its cursor every five minutes. After three hours
  with no chunk advancing, the source fails for that run with its prior
  inventory still published, and retries after its usual delay; the failure
  message carries the Kernel refusal. A 403 lasts until the next monthly
  period or a higher cap, so it fails each run this way until then. Raise the
  cap or move the source back to Hyperbrowser.

### Checking Kernel usage without the dashboard

All with `Authorization: Bearer $KERNEL_API_KEY`:

- `GET /org/limits`: `max_concurrent_sessions`, `concurrent_sessions_used`,
  `concurrent_sessions_available`.
- `GET /browsers?status=all&limit=100&offset=N`: each browser's `created_at`,
  `deleted_at`, `headless` and `usage.uptime_ms`. Sum `uptime_ms` over a
  window separately for headless and headful browsers; the gross cost before
  credits is headless seconds × 0.0000166667 plus headful seconds × 0.0001333.
  Only U Pull R Parts runs headful. The [metered sources](#metered-sources)'
  own spend is also in `kernel_browser_usage`.
- `GET /browsers` (active only) should be empty outside a run; delete any
  leftover with `DELETE /browsers/{id}`.

### Measured cost

Count-only soaks from a workstation on November 23 and 24, 2026, with direct
egress, using Kernel's own `usage.uptime_ms` for every browser (all deleted):

| Source          | Result                                     | Browsers | Browser-seconds | Cost at $0.0000166667/s |
| --------------- | ------------------------------------------ | -------: | --------------: | ----------------------: |
| Big D           | complete, 4 pages, 299 vehicles            |        1 |            24.5 |                $0.00041 |
| Northwest       | complete, 380 pages, 6,690 cars            |       48 |         1,289.3 |                $0.02149 |
| Vander Haags    | complete, warm, 77 details, 1,995 vehicles |        7 |           555.9 |                $0.00926 |
| U Pull It Davie | complete, 120 pages, 1,436 vehicles        |        1 |             4.9 |                $0.00008 |

Big D and Northwest match their last accepted production runs (299 and
6,690). Vander Haags read the same 77 details as its last accepted run
(November 23: 1,989 vehicles, 2,108 donors; the soak saw 2,115 donors, 7
new). U Pull It Davie's last accepted run, 16 hours earlier, had 121 pages
and 1,446 vehicles; its catalog moved between 1,414 and 1,446 that week.
Northwest's cold read is the full 380-request census, about 22 minutes and
one browser per eight-request chunk; its incremental days read about 100
pages. A day of all four (Northwest cold, Vander Haags warm, the others in
full) is about 1,875 browser-seconds, about $0.94 a month, inside the
Developer plan's $5 credit.

U Pull R Parts bills headful seconds and is crawled in full every day; its
spend and caps are in [Kernel spend](upullrparts-ingestion.md#kernel-spend).

### Metered sources

U Pull R Parts, 603 and City Motors open their Kernel browsers through
`DocumentTransport.meteredSourceSessions`, which records each browser in
`kernel_browser_usage` (from before its create to its delete) and refuses a
create, deferring the chunk without a request to Kernel, once the source's
spend this UTC day or month reaches its cap in `kernel-usage.ts`. The caps
are per source, so one source's spend never stops another. The monthly caps
add up to $3.90, leaving about $1.10 of the $5 credit for the unmetered
sources (about $0.94 a month). Michigan Truck is retired (paused and hidden
in `source_control`), stays on Hyperbrowser and has no Kernel cap.

| Source         | Mode     | Daily cap | Monthly cap | Normal day                         |
| -------------- | -------- | --------: | ----------: | ---------------------------------- |
| U Pull R Parts | headful  |     $0.25 |       $1.80 | about $0.02 to $0.03               |
| 603            | headless |     $0.15 |       $0.60 | about $0.01 warm, about $0.05 cold |
| City Motors    | headless |     $0.15 |       $1.50 | about $0.01 to $0.04               |

A count-only soak of 603 on Kernel from a workstation on November 24, 2026,
with direct egress, as recorded by the soak's local `kernel_browser_usage`:

| Source | Result                                          | Browsers | Browser-seconds |    Cost |
| ------ | ----------------------------------------------- | -------: | --------------: | ------: |
| 603    | complete, cold census, 1,029 GETs, 973 vehicles |      130 |         2,981.5 | $0.0497 |

It matches 603's last accepted production run (November 23: 973). The first
603 run after a gap of more than a day is a cold census (every donor
article); later days carry unchanged articles and read about 170 documents.

City Motors reads its whole census (213 GETs in November 2026) every day. Most
of a census's browser time is the origin rendering donor pages its LiteSpeed
cache does not hold, about 10 seconds each; cached pages take under half a
second. Two count-only soaks on November 25, 2026 did not complete, because
the origin itself stopped answering some donor pages (one page did not answer
a plain workstation request within 120 seconds either); Cloudflare refused
none of their browser reads. The first, before the edge landing, spent
$0.0335 in 30 browsers; the second spent $0.0360 in 45 browsers, most of it
waiting on those pages. A census on a healthy origin is estimated at about
$0.01 (cached) to $0.04 (uncached).

To check a metered source's spend: `select sum((coalesce(ended_at, started_at + 420000) - started_at) / 1000.0) * 0.0000166667 from kernel_browser_usage where source = '<source>' and started_at >= <start of the day or month, ms>`
(use 0.0001333 for U Pull R Parts, which runs headful).
