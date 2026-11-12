# Pull & Save Washington ingestion

Source: `pullsavewa`. Keep it disabled until the source admission and production rollout are approved. This source is separate from `pullnsave` and Washington GO2 `upullitwa`.

The two physical yards are Mead (11125 N Market St, 509-928-4000) and Spokane Valley (10414 E Knox Ave, 509-921-8000). Each current official home identifies a completely self-service parts yard and links its own native inventory catalog. Both yard coordinates come from saved public directory JSON-LD matching the exact native addresses and official domain. Mead's native map `ll` coordinates identify a viewport center and remain separate evidence. The native Spokane map also contains a legacy University address target. That target does not establish an address alias or a third yard.

## Complete native scope

For each yard, fetch its official home, the default catalog, the source-published `recperpage=ALL` GET control, and the default catalog's source-published terminal page. The complete ALL response suppresses pagination and retains two empty pager forms. The default and terminal pages publish record ranges twice. Require the ALL row count to match those fresh ranges and require exact native field parity with the first and terminal controls.

The parser checks the complete table grammar, named columns, contiguous native row indices, native stock/detail destinations, empty native search fields, null filter state, GET pager forms, ALL selector and terminal controls. It rejects duplicates, scope drift, truncation, changed ownership, redirects, non-HTML responses and partial or non-200 responses. Requests are rate limited and never retried.

The source's exact disclaimer is preserved in crawl warnings:

> Since we are continuously updating our inventory, the information you are viewing is approximately 90% accurate. Pull & Save Auto Parts cannot confirm or deny locations or parts availability.

Catalog membership in that native self-service context supplies availability evidence. Individual part availability is not guaranteed. Mead stock `073ES`, VIN `3FAFP07176R109736`, has native position `SCRP`. Its meaning is unproved, so retain the literal position without inventing a status. Explicit `hold`, `crush`, `sold` or `unavailable` positions are rejected with valid identity presence retained.

## Required fields and checkpoints

Require the native VIN or genuine pre-1981 serial, year, make and model. Use the shared `inventoryVin` validator without decoding, repairing or adding a checksum gate. Stock, source Date Set and position are optional. Missing or invalid optional values remain null. Calendar-invalid or future dates remain null. Preserve native stock case. Color remains null. Preserve a published native photo URL only when its yard folder, numeric filename and enclosing native stock detail anchor validate. Missing, ambiguous, invalid, foreign or placeholder photos remain null. Do not fetch image bytes or invent larger photo URLs.

Each yard must emit at least one vehicle and remain within the existing 10% rejection limit. A valid identity on a metadata reject supplies presence evidence only. The complete-source minimum is 1,800 vehicles. Existing source validation and reconciliation policies still apply.

Snapshots are atomic per yard. Callbacks run only after complete snapshot validation. A failed callback returns no advanced checkpoint. The serialized cursor pauses after Mead and retains all valid identities, including rejected presence, to detect duplicates in Spokane Valley after resume. A complete cursor makes no requests.

## Verification

Run focused checks:

```sh
bun test src/server/ingestion/pullsavewa-parser.test.ts src/server/ingestion/pullsavewa-transform.test.ts src/server/ingestion/pullsavewa-connector.test.ts
```

`scripts/soak-pullsavewa.ts` accepts a count/discard chunk callback and a one- or two-yard budget. It has no database or Blob access. Use the shared soak CLI only for an explicitly authorized native read.

The saved November 12, 2026 replay processed 2,071 native rows: Mead 1,049 accepted and three rejected, Spokane Valley 1,016 accepted and three rejected. It emitted 2,065 vehicles, including 45 historical serials and 2,065 native photo references, and retained four rejected identities for presence. Eight saved responses traversed two serialized checkpoints through the actual connector, shared durable codec and soak driver. Shared terminal source validation passed. Evidence and canonical output hashes are in `.scratchpad/coverage/parallel-ny-nj-de/pull-save-wa/connector-terminal-replay.json`. The replay used no live HTTP, database writes, Blob writes or source enablement.
