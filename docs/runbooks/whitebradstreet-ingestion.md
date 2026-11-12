# White & Bradstreet ingestion

Source ID: `whitebradstreet`. Native inventory: <https://white-bradstreet.com/trucks/?f-condition=nw>.

## Native contract

- Physical yard: White & Bradstreet, 1020 Weeks Mills Rd, Augusta, ME 04330. Phone: 207-622-2622.
- The source-published map link is <https://maps.app.goo.gl/Ufxo1ycqWZjpHmtX8>. Its saved redirect identifies the business place at `44.3404252, -69.659884`, using the explicit `!3d` and `!4d` markers.
- The current native `Condition: Salvage` filter enumerates active donor trucks. Each row must retain that condition and three matching native donor links. A source-linked detail must explicitly say `Now Wrecking` and match its listing VIN, year, make and model.
- Every listing and detail control must retain the native yard address, phone and map destination. Parts listings and retail Complete trucks are outside this traversal.
- Required fields are the native valid VIN or eligible pre-1981 serial, year, make and model. Do not repair invalid identities or infer missing metadata.
- Stock, photos, color, source inventory date and yard position are optional. Unpublished values remain `null`. A photo is accepted only from a published native image reference under the verified TPI account `28272`.
- Rejected required metadata still supplies presence-only evidence when its native VIN is valid. Rejection and canonical duplicate limits remain 10% and 25% respectively.

## Checkpoints and transport

`WhitebradstreetCursor.initial` starts the bounded connector. Default chunks process eight new native pages, with a supported budget of 1-32. The cursor stores all prior native IDs, canonical identity outcomes, page hashes and cumulative counts. Its schema checks monotone page coverage, unique native IDs and consistent accounting.

Resume rereads the complete prior prefix and compares semantic page hashes and the reconstructed ledger before emitting new work. Completion rereads every enumerated page to reject changes during the crawl. Native ranges, two matching pagination controls, row counts and terminal pagination must agree with the advertised total. A complete cursor performs no requests or callbacks.

Requests are sequential at one per 1,600 ms. Each has a 20-second timeout and no retries. A chunk has a two-minute limit. Responses must be complete HTTP 200 HTML at the requested native destination, bounded to 4 MiB, valid UTF-8 and consistent with any uncompressed Content-Length. Authentication failures, 429s, partial responses, redirects, MIME changes, drift or malformed controls fail without an advanced checkpoint. Previous published inventory remains preserved by the ingestion staging boundary.

## Qualification evidence

The saved 2026-11-11 enumeration reached all 16 pages and all 386 distinct native donor IDs. The complete connector replay emitted 382 unique donors, rejected four invalid native identities (1.04%) and found zero canonical duplicates. No rejected record supplied a valid VIN. The source minimum is 350 admitted donors, grounded in this complete baseline.

Rejected IDs and unmodified native identity values:

| Native ID | Published year | Published identity  |
| --------- | -------------- | ------------------- |
| 189468    | 2006           | `4v4nc9tko7n458072` |
| 167993    | 1999           | `30-65131-7-90`     |
| 166119    | 2000           | `1GDKH1C9YJ500073`  |
| 155817    | 2009           | `1S124HM244007779`  |

Evidence root: `.scratchpad/coverage/parallel-me-nh-vt/white-bradstreet-requalification/`.

- `checkpoint.json`, `page-001.json` through `page-016.json`, and corresponding HTML bodies preserve the complete native traversal.
- `identity-audit.json` preserves accepted and rejected native identities.
- `integrity-replay.json` verifies saved raw response hashes and native detail linkage.
- `shared-parser-field-parity.json` compares every parsed native ID, year, make, model, VIN, lot and engine with the independent saved native-field audit. A regression test prevents native price headings from consuming the first make field.
- `connector-replay.json` records the complete saved-response connector replay through two serialized cursor chunks with count/discard callbacks. It verifies 382 emitted identities, four rejects, zero duplicates, 16 new pages and one yard.
- `yard-ownership-and-pin.json` and `native-yard-map.json` preserve native contact and place-pin evidence.
- Active native detail control: `../evidence/white-detail-193589.html`, matching 2010 Peterbilt 386, VIN `1XPHD49X0AD113809`, lot `471B`.

The soak helper in `scripts/soak-whitebradstreet.ts` accepts a connector callback and aggregates bounded chunks. It has no database or Blob access. Qualification and saved replay do not enable the source or write production inventory.

## Verification

```sh
bun test src/server/ingestion/whitebradstreet-connector.test.ts src/server/ingestion/whitebradstreet-transform.test.ts src/server/ingestion/truck-parts-catalog.test.ts
bunx oxlint src/server/ingestion/whitebradstreet-*.ts src/server/ingestion/truck-parts-catalog*.ts scripts/soak-whitebradstreet.ts
bun run typecheck
```

Tests cover optional-null acceptance, old serials, presence-only rejects, cumulative limits across chunks, conflicting identities, source ownership, active scope, full-prefix and terminal drift, HTTP and body boundaries without retries, cursor tampering, pause/resume and complete-cursor idempotence.
