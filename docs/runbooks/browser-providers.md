# Browser providers

Sources whose sites refuse the deployment's egress read their documents
through a remote browser. Two providers open those browsers:

| Provider     | Sessions module                                 | Key                    | Concurrency variable                                | Lease group    |
| ------------ | ----------------------------------------------- | ---------------------- | --------------------------------------------------- | -------------- |
| Hyperbrowser | `src/server/ingestion/hyperbrowser-sessions.ts` | `HYPERBROWSER_API_KEY` | `HYPERBROWSER_CONCURRENT_SESSIONS` (unset: 1, Free) | `hyperbrowser` |
| Kernel       | `src/server/ingestion/kernel-sessions.ts`       | `KERNEL_API_KEY`       | `KERNEL_CONCURRENT_SESSIONS` (unset: 5, Developer)  | `kernel`       |

Each provider has its own account, its own concurrent session limit and its
own lane group in the session lease, so a busy Hyperbrowser plan never holds
back a Kernel source and the reverse. Both use the same lease rules and lock
order ([Session lease](hyperbrowser-sessions.md#session-lease) and
[Lock order](hyperbrowser-sessions.md#lock-order)) and the same page
preparation, transport modes and subresource routing in
`document-transport.ts`. The concurrency variables are validated by
`src/env.js`, so a value that is not a whole number from 1 to 999 fails the
build.

## Who uses which

| Source                      | Chosen in                                           | Provider     |
| --------------------------- | --------------------------------------------------- | ------------ |
| URG IIS, 11 browser tenants | `transport` per tenant in `urgiis-configuration.ts` | Kernel       |
| URG IIS, other 9 tenants    | same                                                | `native`     |
| Big D                       | `BROWSER_PROVIDERS` in `browser-providers.ts`       | Hyperbrowser |
| Northwest                   | same                                                | Hyperbrowser |
| 603 Auto Salvage            | same                                                | Hyperbrowser |
| Michigan Truck Parts        | same                                                | Hyperbrowser |
| U Pull It Davie             | its own session module (not provider-selectable)    | Hyperbrowser |
| Vander Haags                | its own session module (not provider-selectable)    | Hyperbrowser |

The choice is typed: `BrowserProvider = "hyperbrowser" | "kernel"`, and a URG
tenant's `transport` is `"native" | BrowserProvider`. Neither is part of any
cursor or census scope (`UrgiisTenant.qualification` leaves `transport` out),
so moving a source or tenant keeps in-flight checkpoints and accepted history.

## Moving a source

1. Change one line: the source's value in `BROWSER_PROVIDERS`, or the
   tenant's `transport` in `urgiis-configuration.ts`.
2. Update the pinned list in `browser-providers.test.ts` (or the transport
   list test in `urgiis-connector.test.ts`).
3. Make sure the new provider's key is set in Vercel (Production and
   Preview). A source assigned to Kernel without `KERNEL_API_KEY` never falls
   back: its browser open fails with "KERNEL_API_KEY is not set, but <source>
   is configured to open Kernel browser sessions", no request is sent, and
   prior inventory is preserved. For URG IIS that blocks only the tenant after
   three reads; the other tenants publish.
4. Soak it locally with the new provider's key (`--sources=<source>`, or
   `--sources=urgiis --urgiis-tenants=<code>`). The soak refuses to start
   without the keys its selected sources and tenants need.

U Pull It Davie and Vander Haags keep their own Hyperbrowser session code
(profiles, page scripts); moving either needs code, not a one-line change.

## Kernel sessions

- Each chunk creates one browser with `POST https://api.onkernel.com/browsers`
  `{ "stealth": true, "headless": true, "timeout_seconds": 60 }` (stealth adds
  Kernel's managed ISP proxy and CAPTCHA solver; the default region is
  `us-east`, choosing one needs a paid plan), connects over CDP with
  `playwright-core` and deletes it with `DELETE /browsers/{id}` when the chunk
  ends, on success, failure or interruption. A 404 on delete counts as already
  deleted. A browser whose delete fails is deleted by Kernel 60 seconds after
  its CDP connection closes; the lease lasts past that, so the next holder
  does not hit the plan limit.
- Billing is per second of browser uptime ($0.0000166667 per headless second,
  about $0.06 per hour), with no minimum. The Developer plan is free with $5
  of usage credit a month and 5 concurrent browsers.
- Refusals:

  | Kernel answer on create                                  | Result                                                                                       |
  | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
  | HTTP 429 `org_limit_exceeded` (concurrent browsers full) | `ProviderCapacityDeferred`: the chunk defers and retries from its cursor                     |
  | HTTP 429 other (create rate limit)                       | `ProviderCapacityDeferred`                                                                   |
  | HTTP 529 (Kernel out of capacity)                        | `ProviderCapacityDeferred`                                                                   |
  | HTTP 403 (spending cap or credit used up), 401, 5xx      | the read fails; for URG IIS only the tenant blocks after three chunks and the others publish |
  | missing `KERNEL_API_KEY`                                 | the read fails the same way, with no Kernel request                                          |

  A spending cap or used-up credit lasts until the next monthly period, so it
  is not deferred: a deferral would hold the whole source (and every native
  URG tenant behind it) for three hours and then fail it. Whether the free
  plan blocks or bills past its $5 credit is not documented; either way the
  code stays correct, and a block shows up as the 403 path above.

### Checking Kernel usage without the dashboard

All with `Authorization: Bearer $KERNEL_API_KEY`:

- `GET /org/limits`: `max_concurrent_sessions`, `concurrent_sessions_used`,
  `concurrent_sessions_available`.
- `GET /browsers?status=all&limit=100&offset=N` (pages with `X-Has-More` and
  `X-Next-Offset`): each browser's `created_at`, `deleted_at` and
  `usage.uptime_ms`. Sum `uptime_ms` over a window and multiply the seconds by
  0.0000166667 for the gross headless cost before credits.
- `GET /browsers/{id}?include_deleted=true`: one browser's `usage` and a
  provisional `cost.estimated_usage_spend_usd`.
- `GET /browsers` (active only) should be empty outside a run; delete any
  leftover with `DELETE /browsers/{id}`.
