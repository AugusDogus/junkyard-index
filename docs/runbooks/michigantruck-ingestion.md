# Michigan Truck Parts ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

Source `michigantruck` covers one physical yard, code `westland`: Michigan Truck Parts, 38658 Ford Rd, Westland MI 48185, 734-722-3800. The native catalog, contact page and source-linked donor detail confirm ownership. Coordinates 42.3249, -83.4221 come from ITPA CompanyID 84 and its business-marker implementation. The native Google embed viewport is separate evidence.

The source runs unless its pause flag serves false. The source minimum is 57 accepted donors. Existing source validation and reconciliation rules remain in force.

## Native scope

Enumerate the source-published unfiltered RESET route, `https://michigantruck.com/trucks/`, by following actual Next links. Native `Salvage` identifies donors. Native `Complete` identifies retail vehicles and is an explicit exclusion. Do not invent a Now Wrecking label or repair malformed sidebar filter links.

The parser checks complete documents, physical ownership, matching header/footer ranges and selected pages, exactly one forward link per pager until termination, stable condition facets, no active filters, expected card counts and unique native IDs. Each card must publish three identical detail URLs under the source's actual SEO detail path. Preserve the published slug rather than constructing a replacement.

Before completion, reread the entire retained traversal, rebuild all identities and counters, and compare every page payload hash. Fetch a source-linked valid donor detail to confirm Salvage and its native identity. Follow its independently published Salvage selector to verify the selected count and the first 25 Salvage donor payloads. The inspected HTTP selector has a recorded canonical HTTPS destination; no sidebar href is repaired.

## Required fields and optional values

Require native VIN or genuine pre-1981 serial, year, make and model. Use the existing `inventoryVin` and canonical make helper without checksum gates, VIN repair or decoding. Missing descriptions, including `Other`, are required metadata rejects. A valid VIN on a rejected donor supplies presence evidence only.

Preserve genuine native lot numbers as stock, account-6 Truck Parts Inventory photo URLs, and real native engine models. An invalid, absent, oversized or placeholder optional value becomes null. Photo URLs must retain the native host, account path and filename without credentials, query, fragment or invented variants. No photo HTTP or byte mirroring is required. Color, source arrival date and row/section/space are absent and stay null. Native stock never supplies a date or position.

Required rejects must remain at most 10% and duplicate vehicles at most 25% of native Salvage rows. Retail exclusions remain separate and never inflate those denominators. Conflicting VIN identities or repeated native donor IDs fail the crawl. Identical accepted VIN/YMM duplicates are counted and emitted once.

## Cursor and budgets

`maxPages` is a budget of one through eight newly consumed catalog pages. Prefix validation and terminal controls do not increase `pagesProcessed`, which counts only new pages. A chunk is separately bounded to 32 gated HTTP requests, three minutes, and complete UTF-8 HTML responses of at most 4 MiB. The native catalog cap is eight pages and 200 rows. Larger scope requires inspection and an explicit code change.

The strict cursor retains declared scope, actual continuation URL, page payload hashes, native IDs, normalized identities and cumulative accepted/rejected/excluded/duplicate counters. Every resume rereads and rebuilds the entire retained prefix before new callbacks. A forged counter, identity, hash, URL, photo or ordering fails validation. Callback or transport failure returns no advanced checkpoint. Earlier successful batches remain partial, and completion is never returned after a failure. A complete cursor makes no requests.

Requests use the shared gate and bounded response reader. Non-200, partial, redirected or foreign destination, wrong MIME, timeout, abort, decoding and body-length failures end the chunk without retries. A Cloudflare 403 or challenge page is never evidence.

Since the first production run on 2026-11-18, Cloudflare has refused most native requests from Vercel with HTTP 403, while the same request from other networks returns 200. Production chunks open one Hyperbrowser session (stealth, accepted cookies, `us-west`, no proxy, no CAPTCHA solving) and load every document by top-level page navigation, as for Big D. The browser owns cookies and headers. The navigation status, headers and exact body bytes pass through the same checks; a redirected navigation reports its first hop, so it fails as a redirect. The session opens with the chunk's first request, after cursor and budget validation, under the cross-source [Hyperbrowser session lease](hyperbrowser-sessions.md), and is stopped when the chunk ends; a busy lease defers the chunk and waiting for it does not spend the three-minute work budget. A complete cursor opens no session. Production chunks take the full eight-page budget, so a normal run is one chunk and one billed session: at most 19 navigations (contact, up to eight new pages, the same pages reread for terminal verification, the active detail and the Salvage selector). A resumed run also rereads its retained prefix, within the 32-request limit. The page routes every request, which disables the browser HTTP cache, so terminal rereads never compare a cached copy. Images, media and fonts are aborted; each navigation still loads the page's scripts, stylesheets and their XHR requests outside the gate.

## Saved verification

```sh
bun test src/server/ingestion/michigantruck-parser.test.ts src/server/ingestion/michigantruck-record.test.ts src/server/ingestion/michigantruck-connector.test.ts src/server/ingestion/document-transport.test.ts
```

`scripts/soak-michigantruck.ts` accepts a count/discard chunk callback and has no database or Blob access. The saved replay at `.scratchpad/coverage/parallel-ny-nj-de/michigantruck/connector-terminal-replay.json` exercises the actual connector, shared durable codec and soak driver with varied checkpoints. It verifies all 180 native rows: 176 Salvage, four retail exclusions, 173 accepted donors, three required rejects and zero duplicates. It preserves all 173 stock/photo references and 146 real engines. Valid rejected VIN `10T3R0FH8S1051546` supplies presence only. Native engine `Other` on donor 189835 becomes null. The accepted 1979 Ford serial `W80DVEC8987` follows the existing identity rule.

Qualification and native receipt evidence are under `.scratchpad/coverage/parallel-wa-or-id/tpi-discovery/`. The independent raw proof is `.scratchpad/coverage/parallel-me-nh-vt/michigantruck-proof-audit/`; KY overlap evidence is `.scratchpad/coverage/parallel-ky-tn-ar/evidence/michigantruck-overlap-verification.json`. The implementation and replay made no live HTTP requests, database writes, Blob writes or source enablement.
