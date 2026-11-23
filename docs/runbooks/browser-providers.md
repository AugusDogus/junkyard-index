# Browser providers

Sources whose sites refuse the deployment's egress read their documents
through a remote browser. Kernel (kernel.sh) is the long-term provider.
Hyperbrowser's free credits were a one-time grant and will run out, so every
browser source moves to Kernel; Hyperbrowser stays available as a one-line
fallback until the last source has moved.

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

| Source               | Chosen in                                     | Provider     |
| -------------------- | --------------------------------------------- | ------------ |
| Big D                | `BROWSER_PROVIDERS` in `browser-providers.ts` | Kernel       |
| Northwest            | same                                          | Kernel       |
| 603 Auto Salvage     | same (retired: paused and hidden)             | Hyperbrowser |
| Michigan Truck Parts | same (retired: paused and hidden)             | Hyperbrowser |
| U Pull It Davie      | its own session module                        | Hyperbrowser |
| Vander Haags         | its own session module                        | Hyperbrowser |

The choice is typed (`BrowserProvider = "hyperbrowser" | "kernel"`) and is not
part of any cursor scope, so moving a source keeps in-flight checkpoints and
accepted history. U Pull It Davie and Vander Haags keep their own Hyperbrowser
session code (profiles, page scripts); moving either needs code, not a
one-line change. URG IIS reads natively: the Cloudflare-blocked tenants were
cut instead ([URG IIS](urgiis-ingestion.md)).

## Moving a source, or falling back

1. Change the source's value in `BROWSER_PROVIDERS` and the pinned map in
   `browser-providers.test.ts`. Falling back to Hyperbrowser is the same
   one-line change in the other direction.
2. Make sure the provider's key is set in Vercel (Production and Preview). A
   source on Kernel without `KERNEL_API_KEY` never falls back on its own: its
   browser open fails with "KERNEL_API_KEY is not set, but <source> is
   configured to open Kernel browser sessions", no request is sent and prior
   inventory is preserved.
3. Soak it locally with the provider's key, count only:
   `bun run soak:sources -- --sources=<source>`. The soak refuses to start
   without the key its sources need. Delete any browser a stopped soak leaves
   (below).

## Kernel sessions

- Each chunk creates one browser with `POST https://api.onkernel.com/browsers`
  `{"stealth": true, "headless": true, "timeout_seconds": 60, "proxy": {"mode": "direct"}}`,
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
- Billing is per second of browser uptime ($0.0000166667 per headless
  second, about $0.06 an hour), with no minimum. The Developer plan is free
  with $5 of usage credit a month and 5 concurrent browsers.
- Refusals on create never fail the run:

  | Kernel answer on create                                     | Result                                                   |
  | ----------------------------------------------------------- | -------------------------------------------------------- |
  | HTTP 429 `org_limit_exceeded` (concurrent browsers full)    | `ProviderCapacityDeferred`: the chunk retries its cursor |
  | HTTP 429 other (create rate limit)                          | `ProviderCapacityDeferred`                               |
  | HTTP 529 (Kernel out of capacity)                           | `ProviderCapacityDeferred`                               |
  | HTTP 403 (spending cap, monthly credit used up, plan limit) | `ProviderCapacityDeferred`                               |
  | HTTP 401, other 4xx, 5xx, missing `KERNEL_API_KEY`          | the read fails with the provider's message               |

  A 403 lasts until the next monthly period or a higher cap, so a source that
  keeps deferring on it goes stale instead of failing; its deferral message
  names the spending cap and credit. Raise the cap or move the source back to
  Hyperbrowser.

### Checking Kernel usage without the dashboard

All with `Authorization: Bearer $KERNEL_API_KEY`:

- `GET /org/limits`: `max_concurrent_sessions`, `concurrent_sessions_used`,
  `concurrent_sessions_available`.
- `GET /browsers?status=all&limit=100&offset=N`: each browser's `created_at`,
  `deleted_at` and `usage.uptime_ms`. Sum `uptime_ms` over a window and
  multiply the seconds by 0.0000166667 for the gross headless cost before
  credits.
- `GET /browsers` (active only) should be empty outside a run; delete any
  leftover with `DELETE /browsers/{id}`.

### Measured cost

Count-only soaks from a workstation on November 23, 2026, with direct egress,
using Kernel's own `usage.uptime_ms` for every browser (all deleted):

| Source    | Result                          | Browsers | Browser-seconds | Cost at $0.0000166667/s |
| --------- | ------------------------------- | -------: | --------------: | ----------------------: |
| Big D     | complete, 4 pages, 299 vehicles |        1 |            24.5 |                $0.00041 |
| Northwest | complete, 380 pages, 6,690 cars |       48 |         1,289.3 |                $0.02149 |

Both match their last accepted production runs (299 and 6,690). Northwest's
cold read is the full 380-request census, about 22 minutes and one browser per
eight-request chunk; its incremental days read about 100 pages. One cold read
of both sources a day would be about $0.66 a month, inside the Developer
plan's $5 credit.
