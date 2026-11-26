# URG Inventory InSite ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

`urgiis` adds independent yard businesses through one multi-tenant connector. Each physical yard has its own location code, address, coordinates and website. Existing Pratt, Central, Northwest and Allied source behavior is preserved. Shared IIS identity, HTML and quarantine primitives are extracted from Allied.

The source runs by default. `ingestion-source-urgiis` pauses it when it serves false. The current source inventory floor is 12,202 accepted donors: the sum of the nine configured tenants' unchanged floors.

The first census follows each tenant’s official owner page, published make directory, all make/model links and its enumerable arrivals page. Subsequent daily runs use the accepted census and weekly slices described below. A tenant with no published arrival cards uses its model graph. The connector rereads the owner, makes and every make menu before emission, including on incremental days. It requires unchanged ownership claims, literal paths, labels and control order. Models added or removed between opening and closing fail even if their badges are zero. Small badge changes are allowed as described below. An arrivals window alone cannot qualify: at least one admitted own-yard donor must come from the current or carried model graph. Arrivals and models are assessed together, with conflicting VIN/destination claims quarantined before deduplication. A modern VIN must pass its check digit; supported pre-1981 serials are accepted. Native year/make/model and an owned per-vehicle destination are required. Arrivals-only donors link to the tenant arrivals page that displays them; modeled donors retain their native detail destination. No identity is decoded or invented.

No tenant emits until its entire graph, closing evidence, ownership and admission guards pass. Durable reconciliation additionally requires the complete tenant prefix and a terminal cursor. A tenant failure blocks only that tenant and is recorded in the terminal cursor: HTTP 403/429 without Retry-After, a page that still fails after three reads in separate chunks, twelve model pages failing in a row, a parse, supplier or structural failure, closing drift, the 1% unreachable allowance, a still-empty model without carryable evidence, or failed admission. Healthy tenants publish after their own closing checks; blocked yards retain their previous inventory and missing/delete counters. Their floors and previous-run counts are excluded only from that run’s eligible publication scope. Each newly blocked tenant raises a Sentry warning, `urgiis tenant <code> blocked; its yards are not refreshed, and any that never published stay missing`. A blocked 403/429 response also records its `server`, `cf-ray` and `cf-mitigated` headers and the first 500 body bytes, so the warning shows whether a CDN rule or the origin refused it. Source-wide failures (the run deadline, the request/body budget, corrupt checkpoints or census state) still prevent source reconciliation, and a run in which every tenant blocks is rejected. Rejected valid VIN claims remain presence evidence.

Directory badges are informational, not asserted donor totals. The traversal follows every literal make/model link and accounts for cards or an explicit native empty result. A page with 500 cards is incomplete. An explicit empty on a structurally broken special-character native model route is platform-unreachable. For Ace St. Paul, Norb's and Chuck's, verified model requests replace the menu's `_-and_` token with raw `_&_`. Their donor links retain the independently published `_and__` spelling. This substitutes one request for one request, preserves literal menu/checkpoint evidence, and accepts only that exact donor-path correspondence. Percent-encoded `%26` remains literal backend text and does not work. Other qualified routes retain their existing encoding. The tested unreachable rule recognizes native names containing `&`, `.` or `(`, and native slug segments containing `-and`, literal punctuation or their percent encodings. No tenant/model allowlist or alternate route is guessed. These advertised donors may total at most 1% of the tenant’s advertised model badges. Publication includes a warning naming every unreachable model and count. Above 1%, only that tenant blocks. All advertised unreachable counts enter this allowance, including badges of one. An ordinary explicit empty advertising at least two donors is retried after the other model pages in the same run, before seller details and closing. If it remains empty, its previous accepted model evidence may defer under the unchanged age, arrivals-window and outage rules. Without eligible prior evidence, only that tenant blocks. Pending empties cannot seed an accepted census. A badge below two can include stale part-bin entries. The connector does not truncate these pages or assume filtering a capped shared pool recovers every owned car. Unknown continuation controls, partial documents, supplier changes and unowned destinations fail closed.

Closing badges allow at most `max(3, floor(enumerated model cards * 0.01))` total absolute count changes per tenant, separately for make badges and model badges across all directories. This matches Hollander's three-vehicle or 1% allowance without counting the same car's make and model badge twice. The denominator uses observed native model cards, including rejected or excluded cards, rather than potentially inflated shared-pool badge totals. Additions and removals in different controls cannot cancel. These badge comparisons cannot detect identity turnover that leaves counts unchanged. Drift totals survive chunk checkpoints. A growing model fails if its closing badge reaches 500 or its observed card count plus badge growth reaches 500, including an empty model whose badge crosses the native boundary. If an ordinary empty model’s closing badge reaches the two-donor threshold, it enters the same later-retry and bounded deferral policy. Closing checks then restart from ownership; seller details are derived again if recovered donors change their task order. A still-empty cold model blocks only its tenant. Tiny carried empties must also be reread when this threshold is crossed. Separate closing model badges reapply the 1% platform-unreachable allowance before publication. Accepted runs publish the donors actually enumerated, without inventing newly advertised cars or dropping observed cars. Structural changes, excessive badge drift and unsafe cap growth block the tenant without retrying closing requests. Its next crawl starts from fresh opening evidence; inspect the captures, and note that prior published inventory remains intact.

Single-yard catalogs reject unexpected supplier photo codes. Shared-pool tenants require an explicit own-photo filter and exclude unassignable photos. Multi-yard catalogs use agreeing native seller and SKU prefixes, with matching stock/year evidence and no contradictory native part VIN, then map each supplier to a verified physical yard. A shared image bucket is not a yard location.

Only explicitly qualified part-bin stocks may be excluded when native VIN claims and yard photographs are absent. Older numeric-stock donors with missing VINs remain rejects. A real VIN claim or yard photograph overrides the bin exclusion. Nationwide's requested blank-VIN exclusion is supported independently. Exclusions never dilute the 10% rejection denominator. Duplicates must stay at or below 25%. Each tenant has an absolute floor; multi-yard tenants also require each yard's floor. Published per-yard inventory must retain at least 50% of its preceding persisted, non-missing count. Final durable validation reapplies every physical yard floor after source-wide deduplication. Source-wide validation also repeats the usual floor, duplicate, rejection and preceding-run checks.

Requests use a current browser User-Agent, normal headers, an explicit public verification cookie where qualified, manual redirects, a combined request/body timeout, a 4 MiB body cap, and a shared serial gate that waits at least two seconds after responses, including failures. HTTP requests percent-encode parentheses in model names while checkpoints and destinations retain the published links. Tenants' Cloudflare cache rule (`x-urg-parts-cache: public-v1`) keeps query-less parts pages for hours, including a render the origin cut off: Norb's served `/parts/ACURA` from cache as 67,462 bytes ending mid-page (a 10.7-second render) on November 25 and 26, 2026, and blocked the tenant. When a page served from that cache (`cf-cache-status` HIT, STALE, UPDATING or REVALIDATED) lacks its closing body and html tags, or ends inside a comment, script or style, a tenant with the verification cookie rereads it once with a unique `cb` query string, which misses the rule and which the plugin does not reflect. The reread must not be served from the cache (a cached reread fails without transport retries), and the parser still rejects a page the origin truncated. There are two paced retries with exponential backoff for ordinary transport failures. HTTP 403/429 stops the tenant immediately without transport retries. A positive Retry-After checkpoints a durable wait on the same frontier; otherwise only that tenant is blocked for the run. Each chunk allows three native pages and eight minutes. Tenants with request timeouts above 60 seconds start model requests in a fresh chunk, and every deferral returns its checkpoint immediately. Incremental runs reserve the last eight minutes of their one-day limit for chunk completion. A cold census with no compatible accepted history has a separate three-day limit and cannot carry or defer old model evidence. Its persistent run-start clock does not move between tenants or retries. Whole runs allow 30,000 successful native requests and 8 GiB of response bodies. Retries are additionally bounded per page. Checkpoints are capped at 16 MiB, bind the complete tenant qualification contract and retain only the current tenant's evidence plus the completed prefix. Completed cursors make no further requests.

Transport/body failures retry the same page twice after four- and eight-second backoffs, with normal response pacing on every attempt. The durable workflow retries a failed chunk twice from its last persisted cursor, allowing up to nine attempts at a failing page within the chunk deadlines. No donor is emitted before closing validation, and exhausted source failures preserve published inventory. For HTTP 403/429 with Retry-After, URG persists `retryAt` in its cursor and uses the existing durable workflow wait before retrying that same page. No other model is requested during the cooldown. Without Retry-After only that tenant is blocked. Ordinary exhausted model failures follow the bounded deferral rules below. A failed page that cannot defer (any page in a cold census, a non-model page, or a model without carryable evidence) is read again in the next chunk, with the failure count in the cursor; after three failed reads in separate chunks only its tenant is blocked. A page that declares no supplier (`var urgid`) is read again the same way; on the third read it fails the supplier check. The scheduler allows three source attempts per ingestion day, at least two hours between their start times, then tries again on a later day. The delay is measured from the prior start, so a long census can become eligible again immediately after failure. This avoids permanent source disablement, but exhausting chunk retries can require an expensive full recrawl. Chunk-budget pauses preserve progress; they are not network-error cooldowns.

Run a count-only soak with:

```sh
bun run soak:sources -- --sources=urgiis --max-pages=30000
```

The soak serializes each checkpoint, reports accepted/rejected/excluded/duplicate counts, and writes no canonical inventory. A capped soak stays incomplete. On a failed guard, retain published inventory and inspect the named request, tenant, raw response and checkpoint. Restart after directory or qualification drift. Never force reconciliation from an incomplete cursor.

Qualification uses saved public responses. Tests are offline. Complete replay archives retain separately fetched opening and closing controls; opening controls are never substituted for closing evidence. Replay order follows the connector; acquisition order is recorded in the HTTP receipts. Large archives use Brotli-compressed JSONL so offline tests decode one raw response at a time. Census coordinates come from the yard's published address unless a yard-published point is available.

Qualification began with serial censuses. Later acquisitions allow at most three active tenants, preserve each tenant's own response spacing, and limit combined request starts to one per 3.1 seconds. All tenant sites are conservatively treated as sharing one URG backend for that acquisition limit. The source connector itself traverses tenants serially.

Concurrent qualification batches on one machine share `/tmp/jyi-urg-gate.lock` and `/tmp/jyi-urg-gate.last`. Before every tenant-origin request, take an exclusive `flock`, read the last timestamp as fractional Unix seconds, wait until 3.1 seconds have elapsed, write the current timestamp, release the lock, then send the request. Keep the tenant's response spacing as well. This cross-process gate belongs to qualification tooling, not product code.

The November 15, 2026 Eagle census followed 37 makes and 284 model pages, then included six arrival observations. It accepted 1,448 unique vehicles, rejected 127 observations, excluded 143 part bins and merged five duplicates. Of 1,717 model cards, 257 had blank VINs (85.0% carried a nonblank VIN). The eligible rejection rate is 127 / 1,580 (8.04%). Its floor is 482. The US Census point for 2744 Eagle School Road, Martinsburg, WV 25404 is 39.468480369268, -77.925464629822. The saved geocoder receipt and full 363-response replay are fixtures.

Batch B qualification, including its admitted yards, exclusions, request ledger and combined daily budget, is recorded in [urgiis-batch-b.md](urgiis-batch-b.md). Its historical counts predate the full restacked configuration; the incremental estimate below includes every configured tenant.

## November 23 tenant cut

Cloudflare refuses native requests to eleven full-service tenants: United, Ace
Iowa, Lentini (Ringoes and Port Murray), Ding's, Bishop's, Central NH, Premier,
Junior Sinn, Revolution, A-Z and MARS. Reading them through paid browsers was
built and stopped (PR #306); on November 23, 2026 the owner cut them instead.
They are removed from `URGIIS_TENANTS`, the yard service map and its evidence
table; `URGIIS_CUT_TENANTS` names them, and a test keeps them and their twelve
yard codes out. None ever published: production holds URG vehicles only for
the nine remaining yards, so nothing on the site changes. The nine remaining
contracts are unchanged, and URG stays fully native; no URG request goes
through a browser ([browser providers](browser-providers.md)).

The tenant list is part of the URG cursor scope (`urgiisFingerprint(tenants)`),
which the crawl, validation and reconciliation stages all check when they parse
the run's cursor. Deploy a tenant change only while no `urgiis` run is active
(`ingestion_run.active_slot = 1`): a run past its crawl still re-parses its
terminal cursor in validation and reconciliation and would fail on the new
scope. The previous accepted cursor also has the old scope, so the first run
after the deploy starts a full cold census of the nine tenants (4,531 requests
in the saved-evidence scenario, about 20 hours at the 15.7 seconds per request
observed in production, inside the three-day cold deadline). Published URG
inventory stays in place until that census is accepted.

## November 18 supplier mismatch isolation

The first production cold census accepted Eagle's 1,447 donors, then failed while
parsing Linder's Cadillac DTS page. The message came from the document-level
`var urgid` check, not per-card photo attribution. The failed run retained an
opening checkpoint with Eagle complete and 129 Linder's entries. It never
published URG. New runs seed history only from an accepted, search-published
terminal cursor, so the next scheduled attempt starts a cold census rather than
resuming this rejected run's checkpoint. In-run durable checkpoints still resume
normally and do not move the persistent start clock.

One public GET to `https://lindersparts.com/parts/CADILLAC/DTS/` on November 18,
under `/tmp/jyi-urg-gate.lock` with the shared pacing timestamp, returned complete
HTTP 200 HTML, two MA09 declarations, two MA09 photographs, and own-origin parts
links. Stocks were T32080 (2008) and T31345 (2006). Capture bytes: 158,241.
The response did not reproduce the earlier mismatch. Neither shared inventory,
a moved donor nor a site defect can be established from this one response.
Raw HTML and headers remain under `.scratchpad/source-failures/` in the worktree.

A typed supplier-identity error now blocks the entire affected tenant, whether
the disagreement occurs in a page declaration during opening/closing or in a
single-yard supplier photo during snapshot admission. The tenant emits no donors,
yard metadata or VIN observations; its previous inventory and missing/delete
counters remain untouched. Other tenants continue from a checkpointed completed
prefix. No card is silently reassigned or dropped under an unproven ownership
assumption. Qualified shared-pool photo filtering remains unchanged.

The existing terminal publication scope already subtracts blocked tenants' floors
and preceding non-missing counts. It also reapplies physical-yard floors and 50%
yard drift after deduplication. Previously, the mismatch bypassed this scope by
failing before terminal evidence. Integration regressions verify successful
publication with a large blocked-yard baseline and confirm that publishing yards
still fail their own floor, drift, rejection and duplicate guards.

The #177 three-day cold deadline and validated-tenant progress heartbeats are
unchanged. Offline tests complete distinct tenants over 40 hours using one fixed
clock, stop before three days, and reject carried cold evidence. Heartbeat tests
cover accepted tenants only, durable replays and previously completed tenants in
failed runs. No additional live census was run during this repair.

## November 19 acceptance blockers

The second cold census accepted Eagle (1,447) and Linder's (3,276), then
blocked Chuckran at `/parts/LEXUS/LEXUS_RX330/` ("expected MA23; observed no
supplier declaration"). United's `/parts/makes/` then returned HTTP 403 without
Retry-After, which ended the whole source. Validation rejected the run, so no
URG inventory has been published.

Both supplier failures were one page each, among 129 Linder's and about 317
Chuckran requests. The November 18 message predates the observed-value detail;
Chuckran's page declared no supplier at all. On November 19 one gated read of
each page returned HTTP 200 with two matching declarations (MA09, MA23) and
normal inventory, as does the saved Chuckran fixture. The plugin prints
`var urgid` in its head config script, so the failing pages rendered without
that config. No site change or other supplier was observed. A page that
declares no supplier is now read again in a later chunk, up to three reads;
only a page that keeps omitting it, or one that declares another supplier,
blocks the tenant. The supplier check itself is unchanged.

United's transport is handled separately. Until it is fixed, a 403 without
Retry-After blocks only United and the other tenants publish. The same
rejection also reported a frozen feed ("newest vehicle arrived 2026-10-01"),
because only Eagle's ISO enter dates were in that partial run; Linder's
publishes purchase dates only. Saved censuses for United, Lentini, Higgins and
other tenants carry November enter dates, so a run with most tenants accepted
passes that check.

## Incremental daily census

Each accepted tenant census retains opening make/model badges, every native model card (including rejected and excluded observations), its stock/VIN identity claims, seller-attribution evidence, and the last successful full read of each model. This preserves the full admission, quarantine, rejection, duplicate and floor checks when old and new evidence are combined. Current arrivals are still assessed with the complete model graph. Only the latest accepted, successful, search-published terminal source cursor seeds another run. Failed, rejected, partial and unpublished runs cannot advance that state.

Every day reads ownership, makes, every make menu and the published arrivals page, followed by separate closing ownership/makes/menus. A model is fully read when its badge changes, an unknown arrival names its model destination or native make/model label, it is new or renamed, it has a deferred retry, or its weekly slice is due. Stock and normalized VIN claims identify a known donor. Yesterday’s arrivals-only donors are also known, so a persistent arrivals window does not cause the same unchanged model to be read daily. A successful model read replaces that model’s entire prior bucket. An unchanged model carries all its prior cards forward. A disappeared model’s donors retire after closing menus confirm its absence; the connector does not request an unpublished route.

Native model order is partitioned by ordinal modulo six against the UTC day, one slice per carry day. A model's slice comes back on the day its six-day carry expires, so the slice read and the age read are the same read and each unchanged model is read once every six days. A slice day with no run since a model's last read (the rest of a multi-day cold census, or an outage) is caught up early, spread over the four days before its age read. After a cold census that ran on two further days, the first incremental week reads about a quarter of the models a day instead of half of them on its fourth day. (Modulo seven read most models twice a week: when the carry expired on day six and again on their slice day seven, about 4,100 requests a day instead of the published 3,627 first-week mean.) The first incremental day already reads its roughly one-sixth slice, even when bootstrap read every model together. The independent six-day carry limit refreshes every model before seven-day acceptance, even if directory changes shift its ordinal. Changed badges and new arrivals add reads outside that slice. The seven-day age ceiling is independent of the slice. Carry and deferral are allowed only below six days, reserving one day for the run to finish. One persistent run-start clock dates reads, carry decisions, retries and acceptance conservatively; late chunk retries cannot move that clock. An incremental run with less than one chunk left before its one-day deadline fails before further requests. A cold run reserves that same chunk margin before its three-day deadline. A recovery run gets the same three-day deadline. A run is a recovery run when the accepted census lacks a current tenant (blocked in the run that published it) or holds a tenant entry accepted six or more days earlier, so nothing of it can carry. That tenant is reread in full, which for Lentini is 3,969 requests and does not fit a one-day run beside the others; without the longer deadline the run would fail, publish nothing, and fail again every day from the same census. A recovery run carries only evidence younger than four days, so evidence stays under seven days when the run publishes. Its work is never more than a cold census, so it fits whenever a cold census does. Every entry ages to six days, so even runs that keep failing end in a recovery run. The run after a successful recovery is incremental again. A tenant that stays blocked makes every run a recovery run, which rereads about half the models instead of a sixth. Bootstrap, corrupt/missing/incompatible history and a backlog after missed daily runs can require a full census. This is necessary to enforce the age ceiling; the safety margin can add reads beyond the nominal slice. Tenants with fewer than six models can naturally have a whole small tenant in one slice.

After the existing paced retries are exhausted, a model HTTP/body request failure or an ordinary explicit empty persisting after its later retry can defer. It keeps that model’s last accepted cards while its last successful full read is less than six days old at run start, records a durable deferred state, and retries next run regardless of badge or slice. A deferred page does not reset that age. Twelve failed model pages in a row, with no successful model read between them, block the tenant rather than probing every page through an outage. Carried models made no request and do not end a streak; later retries reread pages that already failed and neither extend nor end it. A failure after a successful model read defers like the first. Norb's backend times out at about 16.5 seconds on its largest models and renders the same "No Results Found" page as an empty model. On November 25, 2026 that hit 19 of its 53 models with 50 or more donors (2,690 of their 5,139 donors) while the others loaded. Replaying its six-day crawl order puts at most five failures in a row. Before November 26 only one deferral was allowed, so on November 25 a second large empty model blocked the whole tenant although its day-old evidence could carry. Evidence at or above six days must be reread successfully. Every deferral is checkpointed before another network request. A new model without prior evidence cannot defer. Parser errors, source/ownership changes, caps, incomplete documents, directory structure changes, closing drift, and failed full-snapshot guards still block the tenant. All closing directories are reread. The existing bounded badge-drift checks and native cap-growth guard apply to the full observed model evidence, including carries. Publication remains a complete snapshot for unchanged reconciliation semantics.

A short arrivals window can lose intervening donors. If every listed donor is new relative to the previous accepted census, or all rows have usable native dates and the oldest date is newer than that accepted run, this tenant is unknown for the day. It must complete a full census, including seller evidence; a failed model cannot defer in that census. A minimum is taken over all dates, without assuming display order. Native purchase date takes precedence over entry date, which is used when purchase date is absent. Day-only dates cannot prove sub-day coverage. Undated windows use the identity-overlap check and retain the weekly-sweep limitation.

A full census is the safe fallback. Restricting fallback to changed make badges and makes still present in the window would miss same-count turnover in a make that has already fallen out of that window. The ordinary request estimate below assumes the window still overlaps accepted evidence; overflow days pay the full-census cost.

Seller-attributed tenants (Lentini) reuse a donor's seller detail while the donor is unchanged: the same detail URL (which binds stock and year), and every previous accepted card for that URL claimed the same single VIN, so the reused seller page was checked against this donor. Each detail records the run start of its read. A freshly read model refreshes its donors' seller details once they are 21 days old; its next read comes within the six-day carry limit, so seller evidence never reaches 27 days, and a carried model or arrivals-only donor refreshes it at 27 days. Unattributed (null) details keep the earlier rule: they are reused only inside a carried model and reread with every model read. New or changed donors always fetch their own seller page. Before contract v6, every model read refetched all of its seller pages, so Lentini spent about 3,550 of its 3,969 full-census requests on details and about 800 a day after the sweep fix; reuse brings its daily cost to about 300.

### Durable state

Cursors are version 2 and remain bounded at 16 MiB. They contain only the current tenant’s graph, completed prefix, freshness metadata, and a private census Blob pointer/checksum. Accepted census evidence uses the existing `IngestionSnapshotStore.checkpointState` protocol. The repository installs its pointer atomically with the guarded checkpoint, and deletes losing staged writes. Census Blobs are written once per validated tenant, rather than for every unchanged page. Cleanup retains only the newest published terminal census Blob; the preceding one becomes collectible after a newer publication. Active checkpoints retain their normal snapshot lifecycle. No Node built-ins enter Workflow imports.

Missing, corrupt or incompatible previous history starts a full census. Corrupt active state fails instead of mixing a partial run with a cold restart. Qualification changes and the census contract version invalidate reuse. New admission/traversal semantics must bump that contract. Contract v4 invalidates earlier census interpretations. Active cursors validate pending retries and structurally broken routes explicitly; pending empties cannot reach closing or acceptance. Offline and count-only runners pass the returned in-memory `checkpointState` into their next chunk; they never read production history.

### Inventory freshness limit and arrivals evidence

A sold car replaced by another car of the same model without the replacement appearing in arrivals can remain listed until that model’s sweep read, at most about six days when daily runs succeed. Missed or failed publications delay corrections. A failure cannot extend a model’s accepted read age indefinitely. This is an explicit freshness tradeoff, not proof that badges detect identity turnover.

If one car sells and another enters the same model on the same day, a new arrival triggers that model’s complete read and catches both changes that day. If the whole arrivals window is new, the full-census fallback catches them. When the replacement never appears in arrivals, unchanged badges cannot reveal the swap: the old car can stay listed and the new one absent until that model’s next sweep, within about six days when daily runs succeed. A newly entered donor with an old purchase date can be buried below the arrivals window immediately. That backdated case relies on the sweep as well.

The saved windows contain 647 dated cards out of 726, including 254 cards with explicit purchase dates. All 249 adjacent purchase-date pairs are in descending or equal order, with zero inversions; all 632 comparable purchase/entry-date pairs likewise have zero inversions. Chuckran’s 19 cards and A-Z’s 60 cards publish neither date. This measures static display order only. It does **not** estimate how often a newly entered car has an old purchase date, because the fixtures have no before/after insertion times. Zero inversions must not be presented as a zero backdating rate. Successive dated captures or an authoritative entry timestamp are needed to measure that rate. The JSON report retains per-tenant date coverage and ordering counts.

The full restacked saved censuses contain 726 distinct tenant/stock arrivals, of which 628 also occur in captured model cards and 98 are arrivals-only. Bishop’s exposes no arrival cards. These fixtures establish that arrivals add useful donors, but contain no longitudinal before/after donor census. They cannot measure the fraction of genuinely new daily donors caught by arrivals or establish a recall percentage. That requires successive dated censuses. The weekly sweep remains necessary even if an arrival happens to be covered in these captures.

### Offline request and runtime estimate

Reproduce the saved [per-tenant evidence](urgiis-incremental-estimates.json) without provider requests:

```sh
bun scripts/report-urgiis-incremental.ts
```

The configuration contains 9 tenants and 9 physical yards after the [November 23 cut](#november-23-tenant-cut). The combined saved-evidence evaluation publishes all 9, totaling **36,780 accepted donors**. The unchanged 1% unreachable rule now permits Ace St. Paul at 1/3,248 (0.03%), Chuck's at 4/3,378 (0.12%) and Norb's at 16/10,258 (0.16%). Eagle's Atlas route recovered two donors, allowing its cold census to publish 1,450 with 8/1,920 (0.42%) advertised donors still unreachable. This includes [Stroud's southern sweep qualification](provider-coverage-south.md), with 3,280 donors and 529 full-census requests. These are offline publication results, not production inventory writes.

The November 17 route investigation made 31 serial public read-only requests, holding `/tmp/jyi-urg-gate.lock` throughout each response and waiting at least 3.5 seconds after the shared timestamp. `coverage-route-probes.json.br` retains every response, URL, status, start/end time and original-body SHA-256. Raw `&` returns all 54 Town & Country and two Town Car cards at Ace, and all 75 and 18 at Norb's. Their native donor links use `_and__`; one published Ace donor detail was independently checked. Percent-encoded ampersands and the other tested menu aliases were empty. A raw-parenthesis probe also reaches Norb's five New Yorker (FWD) cards, but this change needs only the verified ampersand substitution to pass the unchanged 1% rule. Other model encodings remain unchanged. All original replay archives remain intact.

Eagle's original Atlas capture is empty, but the same unmodified native route now returns two cards. Its replay retains the initial empty, reads the other model pages, then uses that successful saved response on the existing later retry. This does not invent replacement census evidence or add a new retry policy. Ace and Norb's model substitutions use one request each and preserve their native donor destinations and all identity, supplier, quarantine and admission checks. Contract v6 (dated seller details) prevents reuse of older census interpretations.

Across all tenants, 86 advertised donors remain platform-unreachable, each tenant below 1%. Arrivals-only donors retain their arrivals-page destination. The 9 publishing censuses require **4,531 requests**, including Eagle's historical-empty retry. The seven-day incremental simulation from bootstrap averages **1,420.7 requests/day**, with a flat daily curve. The simulation has no badge or arrival changes and no seller detail old enough to refresh; in steady state about 1.8% of the 3,731 models a day change (about 67 more reads), so expect **about 1,500 requests/day**. The report also simulates a recovery day, carrying under four days: all tenants together make 2,661 requests. The largest recovery run, with Norb's missing from the census, makes 2,995 requests: 486 scenario minutes, or about 13 hours at the 15.7 seconds per request observed in production, inside its three-day deadline. At six seconds per response plus configured pacing, the full scenario takes 737.9 minutes and the incremental scenario 231.2 minutes. These scenarios exclude new arrivals, badge changes, outages, storage/workflow overhead and future retries. The cut tenants' earlier figures (74,217 donors, 12,339 full and 2,857.5 daily requests for 20 tenants) are in git history.

Cold census monitoring uses finite, durably staged tenant progress. After a tenant passes its complete graph, closing and admission checks, and its checkpoint is saved, the runtime pings only the existing heartbeat. It neither reports publication nor resolves a delayed status report. Pages, blocked tenants, cooldowns, failures and replayed checkpoints do not ping. Completed tenants in earlier failed attempts with the same qualification scope suppress repeat pings until another accepted inventory publication, preventing a repeatedly failing crawl from appearing healthy. A stuck or failed source still goes red after 30 hours without new accepted progress. Terminal publication keeps its existing heartbeat and report behavior. No Better Stack configuration, production data or flags were changed. The roughly 43-hour bootstrap can finish within the separate, bounded three-day cold deadline; incremental runs retain the one-day deadline and seven-day evidence ceiling. Monitoring adds no URG requests.

| Tenant      | Saved-evidence result | Accepted | Unreachable / advertised |
| ----------- | --------------------- | -------: | -----------------------: |
| eagle       | published             |    1,450 |                8 / 1,920 |
| linders     | published             |    3,274 |                3 / 3,427 |
| chuckran    | published             |    3,671 |                3 / 4,037 |
| ace-st-paul | published             |    3,070 |                1 / 3,248 |
| chucks      | published             |    2,623 |                4 / 3,378 |
| higgins     | published             |    1,477 |                6 / 1,705 |
| lambert     | published             |    8,985 |               24 / 9,440 |
| norbs       | published             |    8,950 |              16 / 10,258 |
| stroud      | published             |    3,280 |               21 / 3,588 |

The request simulation includes all publishing tenants. Times are explicit scenarios, not measured live runtimes.

| Tenant      | Full requests | Menus/arrivals only | Incremental requests/day (first-week mean) | Full minutes | Incremental minutes |
| ----------- | ------------: | ------------------: | -----------------------------------------: | -----------: | ------------------: |
| eagle       |           364 |                  79 |                                      126.3 |         49.7 |                17.3 |
| linders     |           513 |                  87 |                                        158 |         70.1 |                21.6 |
| chuckran    |           498 |                  91 |                                      158.9 |         78.8 |                25.2 |
| ace-st-paul |           423 |                  81 |                                        138 |           67 |                21.9 |
| chucks      |           502 |                  87 |                                      156.1 |         79.5 |                24.7 |
| higgins     |           317 |                  77 |                                        117 |         50.2 |                18.5 |
| lambert     |           611 |                  99 |                                      184.3 |         96.7 |                29.2 |
| norbs       |           774 |                 107 |                                      218.1 |        122.5 |                34.5 |
| stroud      |           529 |                  91 |                                        164 |        123.4 |                38.3 |
| **Total**   |     **4,531** |                     |                                **1,420.7** |    **737.9** |           **231.2** |

## Historical qualified-yard counts

These original counts describe the retained captures. The current publication decisions above supersede their eligibility; blocked captures cannot seed publication or census reuse. Rows and paragraphs for the eleven tenants cut on November 23 are historical only.

| Yard                               | City          | State | Accepted | Rejected | Skipped | Duplicates | Floor |
| ---------------------------------- | ------------- | ----- | -------: | -------: | ------: | ---------: | ----: |
| Eagle Auto Parts                   | Martinsburg   | WV    |    1,448 |      127 |     143 |          5 |   482 |
| Linder's Inc                       | Worcester     | MA    |    3,274 |      159 |       0 |         54 | 1,091 |
| Chuckran Auto Parts                | Bridgewater   | MA    |    3,671 |      369 |       0 |         13 | 1,223 |
| United Auto Recyclers              | Omaha         | NE    |   12,356 |       56 |       0 |          5 | 4,118 |
| Ace Auto Recyclers                 | Iowa City     | IA    |    1,524 |      172 |     125 |         56 |   508 |
| Lentini Auto Salvage - Ringoes     | Ringoes       | NJ    |    2,429 |   shared |       0 |     shared |   809 |
| Lentini Auto Salvage - Port Murray | Port Murray   | NJ    |      924 |   shared |       0 |     shared |   308 |
| Ding's Auto Parts                  | Litchfield    | CT    |    1,110 |      109 |       0 |         24 |   370 |
| Bishop's Auto Parts                | Middletown    | CT    |    3,362 |       82 |       0 |          0 | 1,120 |
| Ace Auto Parts                     | St. Paul      | MN    |    3,015 |      185 |       0 |         54 | 1,005 |
| Chuck's Auto Salvage               | Grand Rapids  | MN    |    2,601 |      283 |     480 |         40 |   867 |
| Central Auto Recyclers             | Concord       | NH    |    2,477 |      193 |       0 |         52 |   825 |
| Higgins Auto Parts                 | Bakersfield   | CA    |    1,477 |       51 |       0 |         48 |   492 |
| A-Z Auto Parts & Auto Sales        | Oklahoma City | OK    |    1,739 |       54 |       0 |         39 |   579 |
| Norb's Auto Salvage                | Denmark       | WI    |    8,864 |      898 |     398 |         43 | 2,954 |
| Lambert Auto Salvage               | Booneville    | MS    |    8,985 |      329 |       0 |          9 | 2,995 |
| Mars Auto Parts & Engine Swaps     | Akron         | OH    |      381 |       30 |       0 |          6 |   127 |

Chuckran's full census follows 43 makes, 407 model pages and 19 arrivals. Its 498-response replay accepts 3,671 donors, rejects 369 observations (9.10%), excludes no rows and merges 13 duplicates. All supplier photographs are MA23. Its floor is 1,223, pacing is 3.5 seconds after responses, and each request has a 90-second timeout. The US Census point for its published Bridgewater address is 41.990325748641, -70.913539837235.

United's full census follows 46 makes, 526 model pages and six arrivals. Its 623-response replay accepts 12,356 donors, rejects 56 observations (0.45%), excludes no rows and merges five duplicates. Every supplier photograph is NE02. Its floor is 4,118. The US Census point for 5702 S 60th St, Omaha, NE 68117 is 41.200697251758, -96.004715979234.

Linder's full census follows 41 makes, 426 model pages and 60 arrivals. It contains 3,427 model cards, with only MA09 supplier photographs. Its eligible rejection rate is 159 / 3,487 (4.56%). The 513-response replay includes separately acquired closing controls. Its US Census point is 42.23811894312, -71.782708739098 for 211 Granite St, Worcester, MA 01607.

Ace Iowa follows 42 makes, 376 model pages and 60 arrivals. Its 465-response replay accepts 1,524 donors, rejects 172 observations (9.82%), excludes 125 verified bulk-part-bin observations and merges 56 duplicates. Saved native detail pages show DORMAN, BROCK, NOF, MONTE, DORMN, 114AFT, BERGER and ORDER holding parts across unrelated vehicles. EPL and AER returned empty details and remain rejects, as do unverified stocks and numeric donors. Every supplier photograph is OO76. Its floor is 508. The US Census point for 2752 S Riverside Dr, Iowa City, IA 52246 is 41.625474637231, -91.543835183719.

Lentini's complete 3,969-response production connector replay passes. It follows all 39 makes, 336 model pages and 60 arrivals, with per-donor parts pages and separate closing controls fetched after those details. It accepts 2,429 donors for Ringoes and 924 for Port Murray. Its tenant-wide accounting is 375 rejected observations (9.52%), zero exclusions and 211 duplicates across 3,939 observations. Rejections cannot always be assigned to one physical yard, so the table marks those totals as shared. Its tenant floor is 1,117, with separate yard floors of 809 and 308. NJ12 and NJ29 map to Ringoes; II08 maps to Port Murray. The shared NJ12 photo bucket is never used to assign a physical yard. Every admitted donor requires agreeing native stock, year, seller and SKU prefix, with no contradictory native part VIN. The native VIN guard was reapplied to all saved details at final admission.

Ringoes publishes 130 US-202, Ringoes, NJ 08551; its Census point is 40.469701869601, -74.861027850067. Port Murray publishes 89 Brickyard Rd., Port Murray, NJ 07865; its Census point is 40.7837265065, -74.91716279734. Separate Census receipts and a filtered public supplier-to-city mapping are fixtures.

Dings follows 36 makes, 246 model pages and 60 arrivals. Its 323-response replay accepts 1,110 donors, rejects 109 observations (8.77%), excludes none and merges 24 duplicates. Every supplier photograph is CT05. Its floor is 370. The US Census point for 99 Little Pitch Road, Litchfield, CT 06759 is 41.725760885077, -73.178934578762.

Bishop's follows all 35 makes and 322 model pages, with no published arrival-card enumeration. Its 396-response replay accepts 3,362 donors, rejects 82 observations (2.38%), excludes none and has no duplicates. Every supplier photo is AA74. Separate closing owner and directory controls pass. Its floor is 1,120. Qualification recovered a slow Spark page with a 90-second timeout and ordinary curl retries; pacing is 3.5 seconds after responses. The US Census point for 120 Stantack Rd, Middletown, CT 06457 is 41.564414369713, -72.749473882561.

Ace St. Paul follows all 38 makes, 342 model pages and 60 arrivals. Its 423-response replay accepts 3,015 donors, rejects 185 observations (5.69%), excludes none and merges 54 duplicates. Every supplier photo is MN25. Its published contact page provides the verified address and JSON-LD point: 754 Rice Street, St. Paul, MN 55117 (44.963964848401794, -93.10545003558208). Its floor is 1,005 and pacing is 3.5 seconds after responses. Literal parentheses in the published New Yorker model path require ordinary percent-encoding for HTTP transport; the native destination is retained.

Chuck's follows all 41 makes, 415 model pages and 43 arrivals. Its 502-response replay accepts 2,601 donors, rejects 283 observations (9.68%), excludes 480 verified part-bin observations and merges 40 duplicates. With its raw-ampersand TOWN & COUNTRY and LINCOLN & TOWN CAR routes (captured 2026-11-23), it accepts 2,623 and 4/3,378 advertised donors stay unreachable. Each of the 25 explicit NOF stocks has native parts from multiple makes and years, with no donor VIN claims. A native VIN or yard photo overrides the bin exclusion. NEW, RIDE and unverified NOF stocks remain rejects. All supplier photos are PP42. Its floor is 867, tenant spacing is 3.5 seconds and the public `urg_hv=1` cookie is required. The Census point for 30187 E. Bass Lake Road, Grand Rapids, MN 55744 is 47.314234240213, -93.604031442421.

Central NH follows all 43 makes, 380 model pages and 60 arrivals. Its 471-response replay accepts 2,477 donors, rejects 193 observations (7.09%), excludes none and merges 52 duplicates. All supplier photos are FF27. Separate closing ownership and directory controls pass. Its floor is 825. The Census point for 54 Basin Street, Concord, NH 03301 is 43.190099292255, -71.523265006371.

## Smith qualification, November 16, 2026

Smith Auto, Inc. remains excluded. Its full 40-make, 392-model census contains
3,275 model cards and 60 arrivals. The candidate production-connector replay
accepts 2,945 unique identities, rejects 218 observations (6.84%), excludes
148 verified NOF, ASA002 and BROCK part-bin observations and merges 24 duplicates.
Those bins have saved native parts across unrelated makes and years with no
VIN claims; numeric and unverified stocks remain rejects. All observed supplier
photos are NE22, and model pages expose full VINs. Identity quality therefore
has headroom, but it cannot establish complete enumeration.

The published F150 route advertises 163 and renders exactly 30 cards without
an enumerable continuation. A separately paced cache-revalidated request returns
the identical donor fingerprint. Stock 261352, VIN `1FTEW1EP9NKD56443`, appears
in arrivals and its own native detail with matching VIN, stock and NE22 seller,
but is absent from that model page. The public plugin's Browse Vehicles action
returns to the make directory and supplies no model continuation. Do not admit
this partial graph or use arrivals to fill its unmeasured gaps.

Qualification used 492 serial live requests, including five failed or aborted
attempts, cache revalidation, native detail probes and geocoders. The 477-response
candidate replay passes owner, closing, checkpoint and identity-quality checks.
That result does not qualify an independently proven partial native graph.

The full failed-census archive, separate closing controls, part-bin probes,
missing-donor proof and request ledger are retained in the URGIIS fixtures.
No Smith entry or published inventory is created. The small completeness
regression preserves the missing-donor evidence and the exclusion.

## Leads left out

This table records initial failures. The fresh qualification sections below supersede later outcomes.

| Yard                          | State   | Reason                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smith Auto, Inc.              | NE      | Published F150 advertises 163 but renders 30 cards with no enumerable continuation. A cache-revalidated read is identical. Its arrivals and native NE22 detail expose stock 261352 / VIN 1FTEW1EP9NKD56443, absent from that model page. Complete enumeration is unproven.                |
| Brown's Auto Salvage          | VT      | The 39,835 badges cover a shared pool. Silverado 1500 advertises 1,325 but returns 500 cards from DD05, BB86, MA06 and AA74. Own-yard filtering cannot repair the cap. Its published `/inventory/` alias returned 404.                                                                    |
| Nordstrom's Automotive        | SD      | The published F150 route advertises 506 but returns an explicit empty result. The ordinary model-name variant also returns empty. Complete enumeration is unproven.                                                                                                                       |
| Nationwide Auto Recycling     | MA      | Both published Mercedes E-Class (502 badge) and C-Class (450 badge) routes return empty. Blank-VIN exclusion is supported, but it cannot recover missing model pages.                                                                                                                     |
| Kosiski Auto Parts            | NE      | F150 stops at 500 shared cards, including AA69 photos. A supplier query does not constrain the pool. Published year search returns parts rather than a complete donor list.                                                                                                               |
| H&H Auto Parts                | NE / CO | NE16, CO26 and CO15 share the NE16 photo bucket. Part details expose supplier prefixes, but official contact information publishes only Cozad and Hudson, and directory searches do not resolve both Colorado supplier mappings. No stock-prefix or physical-yard assignment was guessed. |
| Intermountain Auto Recycling  | ID      | Published model routes are empty or return a capped pool of 500 foreign cars. The normal model-name and supplier-query variants do not reveal a complete own-yard route. Arrivals alone are incomplete.                                                                                   |
| Riverbend Recycled Auto Parts | IA      | Initially interrupted by two read timeouts and HTTP 500 on Ford E250. Slow probes now recover, but a fresh complete census is deferred pending the backend API investigation.                                                                                                             |
| EL&M Auto Parts               | NJ      | Explorer reaches 500 shared cards before filtering to NJ15. The 22 NJ15 photos in that truncated result do not prove complete own-yard coverage.                                                                                                                                          |
| Automotive Parts Solutions    | MN      | The published `/parts/ROVER_-_STERLING` make advertises one donor but renders an empty vehicle table instead of a model directory. Two ordinary spaced curl retries return the same incomplete graph. Rockville's MN12 attribution was verified, but arrivals alone cannot qualify.       |
| Metro Auto Salvage            | MN      | The published Ford F150 Pickup model route returns 500 shared cards before the MN06 own-yard filter. Filtering the truncated pool cannot prove complete inventory.                                                                                                                        |
| John's Truck & Auto Salvage   | NH      | Complete enumeration fails the rejection guard: 625 / 2,534 observations rejected (24.66%), largely for missing or invalid VINs. Even skipping every repeated or blank-stock observation would leave rejection above 20%.                                                                 |

John's NH completed 45 makes, 386 model pages and seven arrivals, with separate closing controls. It has 1,903 candidate donors, 625 rejected observations and six duplicates out of 2,534 observations (24.66% rejected). There are 611 missing or invalid native VIN observations, including 60 missing stock/destination fields. Even hypothetically skipping all 135 repeated or blank-stock observations leaves 490 / 2,399 rejected (20.43%). No placeholder stocks were excluded. The tenant remains out. The fixture receipt and complete 481-response raw census retain this failure for offline inspection.

A-Z Auto Parts & Auto Sales (OK09, OK) was initially excluded after its published `/parts/KIA/SPORTAGE/` route timed out after 90 seconds on all three paced attempts. The complete directory contains 27 makes and 183 models, but only 162 model pages completed and no closing controls were reached. Those pages contain 1,752 cards; the largest result is 118, twelve pages exceed 30, and none returns exactly 30 against a higher opening badge. The native arrivals page explicitly says vehicles may not have been parted out yet, so this is a donor-parts feed rather than retail auto-sales stock. Its exact known arrivals title is supported. The slower fresh census described below supersedes that interrupted run.

Lake Point Auto Recycling (UU23, UT) was initially excluded because its official pages omit the inline URG supplier declaration. Slower re-examination found the native `var urgid='UU23';` and `iisHomeUrl='lakepointauto.com'` declarations in LiteSpeed's combined scripts. Six saved scripts have MD5 content hashes matching their literal filenames. The parser recognizes only their exact optimized-script tags, version and origin, requires a single optimized script, and still rejects contradictory inline supplier declarations. Changed hashes, versions, commented references and additional unknown bundles fail closed. This resolves the markup variant without treating `uu23` photographs as ownership proof. Admission still requires a fresh complete census.

Transwest Auto Parts (UT08, UT) remains excluded after its published Titan model advertises 38 observations but renders exactly 30 cards. There are no native continuation controls. The ordinary `?page=2` route returns HTTP 404 on all three spaced attempts; `?paged=2` repeats the same 30 records. Other models return more than 30, so this is an unresolved model-specific completeness boundary, not proof of a site-wide fixed limit. No partial inventory is admitted.

Norb's Auto Salvage (EE91, WI) was initially excluded after the published `/parts/FORD/TAURUS/` route failed DNS resolution on all three paced attempts. Its full directory graph contains 51 makes and 672 models, but the interrupted model census cannot prove complete inventory. Earlier large pages returned 299 F150 cards and 208 Explorer cards, rather than a 30-card result; this does not qualify the unread models.

Southwest Auto Recycling (UT11, UT) was initially excluded after the published `/parts/MERCURY/GRAND_MARQUIS/` route returned HTTP 500, timed out after 90 seconds, then returned HTTP 500 on its last paced attempt. Its complete 45-make, 372-model directory is saved, but only 129 model pages completed. No rejected stock was skipped to hide the interrupted census. `batch-c-excluded.jsonl.br` retains the partial captures and failure receipts for all five excluded leads.

## Live qualification requests

The original qualification ledger records 10,378 HTTP attempts, including geocoding and retries. Six known unlogged attempts bring the recorded-plus-known count to 10,384: two initial Eagle requests, one Kosiski plugin script and three early Metro timeouts. Redirect hops are not counted separately, so this is not an exhaustive wire total. One shared public supplier-directory attempt is included in the ledger outside the per-tenant rows.

| Tenant                           | Recorded HTTP attempts | Known unlogged attempts |
| -------------------------------- | ---------------------: | ----------------------: |
| Eagle Auto Parts                 |                    368 |                       2 |
| Brown's Auto Salvage             |                      9 |                       0 |
| Nordstrom's Automotive           |                      7 |                       0 |
| Nationwide Auto Recycling        |                      9 |                       0 |
| Linder's Inc                     |                    519 |                       0 |
| Chuckran Auto Parts              |                    505 |                       0 |
| United Auto Recyclers            |                    626 |                       0 |
| Kosiski Auto Parts               |                      8 |                       1 |
| H&H Auto Parts (Cozad)           |                     16 |                       0 |
| Riverbend Recycled Auto Parts    |                     34 |                       0 |
| Ace Auto Recyclers               |                    479 |                       0 |
| Intermountain Auto Recycling     |                      6 |                       0 |
| Lentini Auto Salvage             |                  4,029 |                       0 |
| EL & M Auto Parts                |                      4 |                       0 |
| Dings Auto Sales and Salvage     |                    326 |                       0 |
| Bishop's Auto Parts              |                    404 |                       0 |
| Ace Auto Parts & Salvage         |                    436 |                       0 |
| Automotive Parts Solutions (APS) |                  1,080 |                       0 |
| Chuck's Auto Salvage             |                    542 |                       0 |
| Metro Auto Salvage               |                     10 |                       3 |
| Central Auto Recyclers           |                    476 |                       0 |
| John's Truck & Auto Salvage      |                    484 |                       0 |

A separate anonymous browser visit to APS's published Google map observed 112 HTTP resources and 78 non-HTTP resources. These are recorded separately from the HTTP ledger. The receipt retains sanitized public URLs, HTTP status where known and timing where recorded; browser tracking parameters and freeform error strings are omitted. Raw browser resource logs are not committed.

Batch C adds a separate `batch-c-requests.jsonl.gz` ledger and `batch-c-qualification.json` summary. Its 573 recorded attempts plus one known unlogged A-Z home request total 574 recorded-plus-known attempts. Counts include retries, DNS failures and two geocoder requests. The shared file gate was introduced during acquisition; earlier attempts used separate batch gates. Every later tenant-origin attempt used the cross-process gate.

| Batch C tenant              | Recorded HTTP attempts | Known unlogged attempts | Outcome                                    |
| --------------------------- | ---------------------: | ----------------------: | ------------------------------------------ |
| A-Z Auto Parts & Auto Sales |                    195 |                       1 | Excluded: three Sportage timeouts          |
| Transwest Auto Parts        |                    104 |                       0 | Excluded: unresolved 30-card Titan result  |
| Southwest Auto Recycling    |                    183 |                       0 | Excluded: bounded Grand Marquis failures   |
| Lake Point Auto Recycling   |                      4 |                       0 | Excluded: missing native supplier identity |
| Norb's Auto Salvage         |                     87 |                       0 | Excluded: three Taurus DNS failures        |

The initial batch C census qualified no tenants. Its partial captures establish no final rejection rate. Later retry qualifications below supersede recovered exclusions. The 50% previous-run guard remains unchanged.

Before the slower retry qualifications, the source needed 8,546 successful native requests and 1,458,598,956 response bytes, within its 30,000-request and 8 GiB limits. Configured response spacing alone requires 5.88 hours. Historical successful URL-matched timings plus pacing estimate 20.79 hours per run before retry overhead: 7,503 timed requests and 1,043 timings imputed from tenant means (or ten seconds when none exist). This is an estimate, not a runtime guarantee. The initial batch C added no daily cost; reassess retry qualifications and sibling additions before rollout.

## Validation

The original qualification admitted 38,191 unique vehicle identifiers across eleven tenants and twelve physical yards, with zero cross-tenant duplicates. The original source floor was 30,000 and every physical-yard floor held. All eleven complete connector replays pass across 8,546 separately captured native responses.

Baseline lint, typecheck and formatting of all 63 changed text files pass. The affected set passes 58 tests. The full `bun test --timeout 15000 src` run passes 4,394 tests across 409 files with zero failures in 860.44 seconds, using CI's pinned Bun 1.4.1. Lentini's full replay completes in 336.56 seconds under its explicit 600-second per-test timeout. Tests use local responses only. No lockfile changed after the machine's global Bun upgrade.

`SKIP_ENV_VALIDATION=1 bunx next build` compiles 117 steps, four workflows and the Next application without `workflow-node-module-error`. Later page collection stops on a missing local PostHog API key. The source runs unless its pause flag serves false; no inventory was enabled.

## Batch A qualification, November 16, 2026

At initial screening, none of the ten batch A tenants qualified. All remained outside `URGIIS_TENANTS`; no new inventory floors or exclusion whitelists were registered. Higgins subsequently qualified in the follow-up recorded below. The source runs unless its pause flag serves false and the 50% previous-run drift guard is unchanged.

| Tenant                      | URG owner | Recorded attempts | Exclusion                                                                                                                                                        |
| --------------------------- | --------- | ----------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heritage Auto Parts         | NN36      |                43 | Ford F250SD returns 30 cards against badge 74. Two valid own-yard arrivals are missing. Maserati also publishes an unlabeled `/parts/MASERATI//` control.        |
| I-17 Used Auto Parts        | AZ29      |                10 | Lexus GS300 returns 30 cards against badge 52. Its native arrivals title also fails the identity guard.                                                          |
| Higgins Auto Parts          | CA22      |                 9 | The published arrivals page has donor cards but fails the native HTML title guard. Three model probes return 67, 28 and 37 cards, without a 30-card cutoff.      |
| Stadium Auto Parts          | CO10      |                16 | F150 and Dodge 1500 return 500 shared cards from CC24 and CO10. Own-photo filtering cannot recover the truncated pool.                                           |
| Tom's Auto Salvage          | TT68      |                32 | Maserati publishes an unlabeled `/parts/MASERATI//` model control advertising one donor. The model graph is not enumerable. F150 returns 47 cards.               |
| Speedway Auto Parts         | IL22      |                43 | Equinox returns 30 cards against badge 86, with MI34 photos despite IL22 ownership.                                                                              |
| Quick Recovery Auto Salvage | QQ32      |               110 | All 43 makes expose 474 models, but Cadillac ATS returns HTTP 500 on three paced attempts. Only 58 model pages complete. Large probes return more than 30 cards. |
| TNT Auto Parts              | UU50      |               336 | Complete census rejects 252 / 1,346 observations (18.72%).                                                                                                       |
| Borges Foreign Auto Parts   | MA15      |               494 | Complete census rejects 460 / 4,167 observations (11.04%).                                                                                                       |
| iDrive Auto Parts           | MI47      |                10 | Ford F150 returns 30 cards against badge 83.                                                                                                                     |

All four 30-card cases have no published continuation controls. Their `?page=2` variants return HTTP 404 on three attempts each; `?per_page=500` repeats the identical 30 records. Heritage's missing F250SD stocks are 260444 (2014) and 260443 (2012). Both have valid native VINs and NN36 photos in arrivals, and 260444 still resolves at its native parts destination. No partial inventory is admitted.

TNT traverses 35 makes, 256 model pages and 60 arrivals. Its 331-response replay contains 1,286 model cards, 1,043 candidate donors, 252 rejects, zero exclusions and 51 duplicates. Every supplier photo is UU50. Even hypothetically excluding all 97 AFT, NOF, CPO and DLRS bin observations leaves 155 / 1,249 rejected (12.41%). Those stocks are not qualified for exclusion. Older donor stocks with missing VINs remain rejects.

Borges traverses 41 makes, 399 model pages and 60 arrivals. Its 486-response replay contains 4,107 model cards, 3,660 candidate donors, 460 rejects, zero exclusions and 47 duplicates. Every supplier photo is MA15. Even hypothetically excluding all 41 MISC, MIS and NEW observations leaves 419 / 4,126 rejected (10.15%). Those stocks are not qualified for exclusion. Both complete catalogs have separately acquired closing owner and directory controls; normal and optimistic negative replays emit zero inventory.

The 1,103 recorded attempts include native pages, recovery probes, retries, two interrupted requests, geocoding and the yard-published map redirect. `batch-a-requests.jsonl.gz` preserves acquisition order, status, timing where recorded and response sizes. `batch-a-qualification.json` records each outcome and source budgets. Replay ordering follows the connector, without substituting opening responses for closing evidence.

Initial acquisition used a within-batch gate. After parent coordination, tenant requests used the shared cross-process `flock` gate on `/tmp/jyi-urg-gate.lock`, with epoch seconds in `/tmp/jyi-urg-gate.last`, a 3.1-second start gap and 3.5-second per-tenant response spacing. One known exception is retained: resuming a paused Borges crawler released a stale reservation, placing the contact request and model-135 starts 155 ms apart on November 16 at 15:02:40 UTC. Pausing around queued requests was discontinued. Both responses and the exception are recorded.

At this initial stage, no tenants were added to daily ingestion. The baseline offline audit remained 38,191 unique identifiers, zero cross-tenant duplicates, a 30,000 source floor and all twelve physical-yard floors satisfied. A complete source run still needs 8,546 successful native requests and 1,458,598,956 response bytes, below the 30,000-request and 8 GiB limits. Configured response spacing contributes 5.88 hours; serial wall time is approximately 8.25 hours at one second per response or 17.75 hours at five seconds per response. These are explicit latency scenarios, not a new live whole-source soak.

Batch A validation passes lint, typecheck, changed-file formatting and `bun test --timeout 15000 src`: 4,574 tests across 431 files, zero failures in 1,718.47 seconds on Bun 1.4.4. The twelve new offline tests cover cutoff evidence and complete negative replays. Lentini's existing full replay completes in 490.85 seconds under its explicit 600-second timeout.

## 30-card enumeration investigation, November 16, 2026

No complete fallback is established by the following probes. The five capped tenants remain unqualified. A badge mismatch alone is not treated as a donor total, but a valid own-yard arrivals donor missing from its model page proves that page is incomplete. Smith Auto NE22 publishes 163 F150s but returns 30 cards; its valid 2022 F150 stock 261352 appears in arrivals with an NE22 photograph and is absent from those 30. Heritage's previously verified missing F250SD stocks remain absent too.

The capped Heritage and uncapped Quick Recovery pages both publish IIS Pro 4.78. All fourteen common downloaded JavaScript/CSS assets are byte-identical, including `iisincludespro3.js`, `urg_style.css`, Bootstrap, Select2, lazyload and tablesorter. Smith's main script is also byte-identical. I-17, Speedway and iDrive's saved pages publish 4.78. Heritage's public `/wp-json/urg/v1/plugins` receipt independently identifies the active IIS AutoPartSearch plugin as version 4.78. This does not establish that their server-side configuration or code is identical. Bundles were fetched once per tenant, then searched locally.

The main script has no `pagenum`, `per_page`, `limit`, `wp-json`, load-more or infinite-scroll handler. Its `offset` references are layout positions; tablesorter filters already rendered tables. The AJAX action names are `getVerticalIIS`, `getMakesIIS`, `getModelsIIS`, `getpartCategoriesIIS`, `getpartCategoriesIISModal`, `getpartTypesIISModal`, `getprefilldataIIS`, `gettireaspectratio`, `gettirerimdiameter`, `fetch_part_type_by_sku_number`, `iis_get_video_by_stock`, `submit_part_inquiry` and `submit_part_offer`. The last two submit customer messages and were not called. The script constructs native parts URLs, `/parts/search/<stock>` and `/parts/tagsearch/<tag>`; its external URG stock URL serves images. No donor-list API host or continuation token is exposed by these assets.

On Heritage's literal `/parts/FORD/FORD_F250SD_PICKUP/` model route:

- `?yr=2014`, `?stock=260444`, `?pagenum=2`, `?offset=30&limit=500`, `?sort=stock&order=desc`, `?start=30` and `?paged=2` repeat the same 30 donor records. `?year=2014` returns HTTP 404. The earlier `?page=2` and `?per_page=500` results are retained in batch A's original evidence.
- Appending `/2014/` or `/ALL/2014/` returns explicit empty parts results. `getModelsIIS` with native `year=2014&make=FORD` returns model selector values, including the same `FORD_F250SD_PICKUP`, rather than donor identities. `getpartCategoriesIIS` returns part types, including `ENGINE_ASSEMBLY`. The native `/ENGINE_ASSEMBLY/2014/` parts route returns an interchangeable engine from 2012 stock 260443, not a complete 2014 donor partition. The normalized `/parts/FORD/F250SD_PICKUP/` model variant returns an explicit empty result.
- `/parts/search/26044` and `/parts/search/260443-260444` return explicit empty results. The exact `/parts/search/260444` request returns a partial HTTP 200 document ending at a loading screen, which fails the complete-document guard. The already published `/parts/FORD/FORD_F250SD_PICKUP/260444/2014` detail still resolves. Resolving a known stock supplies no enumerable stock domain, range boundary or terminal condition; guessing numeric stocks would miss alphanumeric and unknown stocks.
- `/latest-arrivals/page/2/` repeats all 82 original arrivals, with identical parsed records. A stock/start query also returns 82 cards. Arrivals remain a window rather than a catalog.
- `/wp-sitemap.xml` and `/sitemap.xml` redirect to `/sitemap_index.xml`. That index lists only `page-sitemap.xml` and `product-sitemap.xml`. The former lists ordinary site pages; the latter contains the shop and two individual parts, with no donor sitemap or further sitemap pagination. `/wp-json/` advertises only `/urg/v1` and `/urg/v1/plugins` in URG's namespace, with no donor, stock or inventory enumeration route.

Higgins' title is exactly `New Arrivals, Recycled Vehicles - Higgins Auto Parts`. This literal title is now allowlisted, with its saved 60-card response as the positive test and changed-title cases as negative tests. The usual supplier identity, complete-document and card guards still apply. Title acceptance alone does not qualify a tenant.

The same `?yr=2014` probe still returns 30 cards on I-17, Speedway and iDrive. Appending `/2014/` returns an empty result on I-17, a parts surface on Speedway and HTTP 404 on iDrive. Smith's sitemap index likewise lists only page and product sitemaps. Heritage's sitemap-published `/inventory/` alias renders unexpanded `[iis_upull_main][iis_upull_main_output]` shortcodes; `/search-inventory/` renders the ordinary year/make/model/part search form. Neither exposes a complete donor list.

`cap-investigation.json.br` preserves research request receipts and deduplicated raw response bodies, including the downloaded bundles. Its SHA-256 body references bind each receipt to the saved response. These probes do not justify a stock-range crawler or a guessed pagination fallback.

## Higgins follow-up qualification, November 16, 2026

Higgins now qualifies after accepting its exact native arrivals title. Its complete census follows 36 makes, 240 model pages and 60 arrivals, with 1,516 model cards. The 317-response production connector replay includes independently acquired closing ownership and directory controls and serialized checkpoints. It emits 1,477 unique donors, rejects 51 of 1,576 observations (3.24%), excludes none and merges 48 duplicates. All 1,528 supplier-photo observations are CA22; 48 observations have no yard photo. The tenant floor is 492, with 3.5-second response spacing and a 90-second request timeout. The source runs unless its pause flag serves false.

Badges are informational and often exceed the observed native lists. Escape has 30 cards against badge 34, but all four recent Escape donors are present. Eight accepted arrivals are absent from their model results. Each of their published native detail URLs returns an explicit empty parts result. These eight donors retain valid native arrivals identities and remain admitted through arrivals under the existing connector contract. This census does not establish that badge totals count enumerable donors or solve the five excluded tenants' proven missing-model-donor cases.

The published address is 12825 S. Union Ave., Bakersfield, CA 93307. Its saved US Census exact-address match is 35.238352730385, -119.003176129205. `higgins.jsonl.br` retains the complete connector replay; `higgins-qualification.json`, `higgins-geocode.json` and `higgins-arrivals-only.json.br` retain the accounting, address receipt and eight empty native detail responses.

Quick Recovery's ATS route returned four cards on two of three follow-up attempts; the middle attempt returned HTTP 500 after roughly 78 seconds. Its resumed acquisition stopped after 116 model pages when qualification was handed to batch C (PR #170). No Quick Recovery contract is added here. No further full-tenant census was started after that handoff.

`cap-investigation-requests.jsonl.gz` records 466 follow-up attempts, including research and census acquisition. The receipt distinguishes a malformed local Higgins URL with no HTTP response, the user-cancelled Quick Recovery request and a discarded mistaken comparison-host 404. `cap-investigation-qualification.json` records these dispositions and the final source audit. Earlier ledgers and qualification summaries remain historical evidence.

The combined offline audit contains 39,668 unique identifiers across twelve tenants and thirteen physical yards, with zero cross-tenant duplicates. Every physical-yard floor holds, and the source floor is 30,492. Complete replays need 8,863 successful native requests and 1,597,323,423 response bytes, below the 30,000-request and 8 GiB limits. Higgins contributes 138,724,467 response bytes. No canonical inventory was written.

Lint and typecheck pass. The full `bun test --timeout 15000 src` run passed 4,574 tests across 431 files with zero failures in 1,614.57 seconds after the title change, before Higgins registration and the new cap-investigation tests. After registration, the batch A and cap-investigation tests pass all eleven cases; the Higgins connector replay and metadata check pass two further cases. Tests use captured local responses only.

Batch C lint, typecheck, changed-file formatting and the 19 focused connector/qualification tests pass. The full `bun test --timeout 15000 src` run passes all 4,569 tests across 430 files in 1,721.70 seconds with CI's pinned Bun 1.4.1, including all eleven complete URG replays. An earlier Bun 1.4.4 full run passed 4,568 tests but timed out the existing Pickers Longview census at its 30-second limit (33.95 seconds). That case passed unchanged in isolation in 23.54 seconds and in the pinned full run in 25.96 seconds. No test timeout was changed.

## Slower retry qualifications

The November 16 retries use serial requests through the shared file gate, with at least 3.15 seconds after every response and between request starts. Previously failing routes are probed alone at separate times before a fresh census. Successful probes do not establish complete enumeration. Census acquisition follows the production traversal; admission requires independently acquired closing controls.

A-Z's fresh run traverses 27 makes, 183 models and 60 arrivals, then rereads 29 owner and directory controls. Its 242-response production replay accepts 1,739 unique donors, rejects 54 observations, excludes none and merges 39 duplicates. Opening and closing badges have zero drift. Sportage succeeds within this run. The floor is 579, pacing is 3.5 seconds and request timeout is 90 seconds. Its Census point for the published Oklahoma City address is 35.492984796916, -97.340050574078. The earlier timeout cause remains unknown; both browser and plain headers now succeed, without observed rate-limit or challenge responses.

MARS's owner page returns a Cloudflare HTTP 403 twice with Chrome and HTTP 200 twice with Firefox under otherwise identical headers. The actual production client also retrieves its native OH25 page using Firefox after one transport retry. A tenant-specific Firefox profile preserves the existing serial gate, cookie, redirect restrictions and body guards. Its full census is deferred pending the separate backend API investigation.

Lambert's previously failing Hummer H2 page succeeds in three isolated probes spaced over three minutes apart, using both browser and plain headers. Historical failures include a timeout, an explicit Redis connection error and a database connection error. This supports a transient backend failure rather than an always-broken model route. Its full census is deferred pending the separate backend API investigation.

The parent stopped page censuses while another agent investigates the backend API. A-Z had already completed and remains the only new admitted tenant. Southwest stopped after 212 successful native responses (45 make directories and 164 models), with arrivals but without closing checks. All other queued full censuses were canceled before starting. No partial run is treated as inventory.

| Retry tenant          | New HTTP attempts | Disposition                           | Diagnosis                                                                                                                                                           |
| --------------------- | ----------------: | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-Z (OK09)            |               247 | Admitted: 1,739 accepted, 54 rejected | Three isolated Sportage successes and a complete fresh census. Original timeout cause unknown.                                                                      |
| Southwest (UT11)      |               217 | Ready for a fresh census              | Three Grand Marquis successes with browser and plain headers. Earlier HTTP 500 bodies name database connection errors. Partial fresh census stopped on instruction. |
| Norb's (EE91)         |                 5 | Ready for a fresh census              | Three Taurus successes with browser and plain headers; original DNS cause unknown.                                                                                  |
| Quick Recovery (QQ32) |                 5 | Ready for a fresh census              | Initial new ATS HTTP 500 names Redis connection error; two subsequent spaced requests succeed.                                                                      |
| Riverbend (NN82)      |                 5 | Ready for a fresh census              | Three E250 successes with browser and plain headers; original failure cause unknown.                                                                                |
| Lake Point (UU23)     |                17 | Ready for a fresh census              | Exact verified LiteSpeed supplier bundles resolve the ownership markup variant.                                                                                     |
| MARS (OH25)           |                 9 | Ready for a census using Firefox      | Two controlled Chrome 403 / Firefox 200 comparisons, successful makes/arrivals and production-client check.                                                         |
| Lambert (MS06)        |                 6 | Ready for a fresh census              | Three H2 successes, plus owner and makes controls. Historical failure bodies name Redis/database errors.                                                            |

The new ledger records 511 attempts, including failed transports, JavaScript assets, eight tenants' geocoding and Lake Point's yard-published map redirect. All use the shared gate. These are additional attempts, separate from the original batch ledgers. All non-A-Z acceptance and rejection totals remain unassessed. Successful recovered pages contain respectively 1 Sportage, 5 Grand Marquis, 123 Taurus, 4 ATS, 58 E250 and 3 H2 cards, below the 500-card cap. No failed model route remains reproducibly broken, so alternate-slug or arrivals-only enumeration was unnecessary. There is no evidence here of a concurrency or rate-limit cause; unknown timeout and DNS causes remain unknown. MARS separately has a repeatable header-dependent WAF block.

With A-Z, the branch has 39,930 accepted donors, twelve tenants and thirteen physical yards. Conservative valid-native-VIN supersets have no cross-tenant overlaps, and all yard floors hold. The source floor is 30,579. Whole-source requests rise to 8,788 and response bodies to 1,498,290,947 bytes, below both hard limits. Mandatory configured spacing is 6.11 hours; baseline timing estimates plus A-Z's successful fresh timings estimate 21.21 hours before retry overhead. This leaves limited daily headroom and excludes sibling additions. Reassess the combined source before rollout.

Production transport retries can resume a saved chunk frontier and do not permanently disable a source. However, there is no durable per-page slow cooldown: exhausted chunk retries end the source attempt, and the next attempt recrawls from fresh opening evidence. The two-hour source delay is measured from the prior start, so a long failed census can be retried immediately. This is safe for preserved inventory but costly and potentially ineffective for backend outages that last minutes. The new regression verifies that a failed model request emits nothing and that resuming its saved frontier completes closing checks before publication. Retry semantics are unchanged.

Final retry validation passes lint, typecheck, changed-file formatting and `git diff --check`. The full `bun test --timeout 15000 src` run with CI's pinned Bun 1.4.1 passes 4,584 tests across 431 files with zero failures in 1,774.91 seconds, including all twelve complete URG replays and the new diagnosis regressions. No source was enabled, no production action was taken, and no full census was started after the parent changed scope.

## Fresh complete qualification censuses

These November 16, 2026 one-time censuses supersede the seven retry-ready
assessments above. Successful isolated probes were not used as inventory.
Every attempted request uses the shared `flock /tmp/jyi-urg-gate.lock` gate and
`/tmp/jyi-urg-gate.last` timestamp, with at least 3.15 seconds between starts and
after each tenant response. At most three tenants are active, each strictly serial.
The ledger includes failures and retries. Each acquisition operation has at most three paced attempts.
MARS uses the previously verified Firefox User-Agent. Lake Point retains exact
verified supplier bundle literals. Its arrivals page newly references
`2c733cc353e1f69c742a7aee3ce9bb31.js?ver=9a323`. One additional gated script GET
confirms that filename equals its MD5 and both native supplier declarations are
UU23 with `iisHomeUrl=lakepointauto.com`. Only this exact literal is added. The
initial three-page census stops at the unknown bundle; its responses and failure
are preserved before starting fresh opening evidence. Unknown hashes or versions
still fail closed. Scripts are inspected as text, never executed.

| Yard                                  | State | Outcome  | Accepted candidates |     Rejected | Requests |    Floor |
| ------------------------------------- | ----- | -------- | ------------------: | -----------: | -------: | -------: |
| Norb's Auto Salvage (EE91)            | WI    | Admitted |               8,864 |  898 (9.16%) |      783 |     2954 |
| Lambert Auto Salvage (MS06)           | MS    | Admitted |               8,985 |  329 (3.53%) |      612 |     2995 |
| Southwest Auto Recycling (UT11)       | UT    | Excluded |               1,526 | 653 (29.78%) |      467 | excluded |
| Quick Recovery Auto Salvage (QQ32)    | LA    | Excluded |               4,766 | 706 (12.80%) |      570 | excluded |
| Riverbend Recycled Auto Parts (NN82)  | IA    | Excluded |          unassessed |   unassessed |      121 | excluded |
| Mars Auto Parts & Engine Swaps (OH25) | OH    | Admitted |                 381 |   30 (7.19%) |       60 |      127 |
| Lake Point Auto Recycling (UU23)      | UT    | Excluded |               1,215 | 179 (12.40%) |      336 | excluded |

Norb's Auto Salvage follows all 51 makes and 667 model pages, then independently rereads 53 owner/directory controls. Closing badge drift is 0 makes / 0 models. The census excludes 398 rows and merges 43 duplicates. Supplier photos belong only to EE91. Its complete production connector fixture replay passes before admission.

Its 4 native parts-page probes independently qualify only the NOR6, NOF generic bins: every page holds parts across unrelated makes and years without donor VIN claims. The 398 exclusions require both absent VIN claims and absent yard photographs; all other blank-VIN stocks remain rejects. The unchanged VIN/photo override still applies. These parts pages prove stock semantics only; their pagination is not used to enumerate donors. The unexcluded census had 1296 rejects, so this is an evidenced bin exclusion rather than a relaxed rejection limit.

Lambert Auto Salvage follows all 47 makes and 512 model pages, then independently rereads 49 owner/directory controls. Closing badge drift is 0 makes / 0 models. The census excludes 0 rows and merges 9 duplicates. Supplier photos belong only to MS06. Its complete production connector fixture replay passes before admission.

Southwest's complete 45-make, 372-model census passes 47 closing controls with zero badge drift. Its 653 rejects among 2,193 observations (29.78%) block admission. The 1,526 candidates are not admitted inventory.

Its rejects comprise 569 blank VIN observations and 84 native-conflict observations. Unverified stocks remain rejects.

Quick Recovery's complete 43-make, 474-model census passes 45 closing controls with zero badge drift. Its 706 rejects among 5,516 observations (12.80%) block admission. The 4,766 candidates are not admitted inventory.

Its reject audit finds 204 blank VIN observations, 215 other invalid VIN observations and 287 native-conflict observations. Two destination failures overlap those reasons. Unverified stocks remain rejects.

Riverbend stops after 74 model pages at the native 500-card boundary on its published [Malibu route](https://riverbendrecycled.com/parts/CHEVROLET/MALIBU/). It has no complete census or closing evidence and remains excluded.

Its published Malibu badge is 62, but the response has 500 shared cards, including supplier photos from ff42, ia08, kk05, nn82. Only 16 photos belong to the own-yard code. Filtering this truncated pool cannot establish complete own-yard inventory.

Mars Auto Parts & Engine Swaps follows all 7 makes and 41 model pages, then independently rereads 9 owner/directory controls. Closing badge drift is 0 makes / 0 models. The census excludes 0 rows and merges 6 duplicates. Supplier photos belong only to OH25. Its complete production connector fixture replay passes before admission.

Lake Point's complete 36-make, 251-model census passes 38 closing controls with zero badge drift. Its 179 rejects among 1,444 eligible observations (12.40%) block admission. The 1,215 candidates are not admitted inventory.

The independently proved NOF generic bin removes 45 non-donor observations from the original 224 rejects. The final eligible rejection rate is still 12.40%, above the unchanged 10% limit. Accepted candidates are not admitted inventory.

Admitted censuses remain below the unchanged 10% rejection guard with at least
0.5 percentage point headroom. No unverified part-bin whitelist, blank-VIN skip,
shared-pool filtering or arrivals-only substitution was introduced. Each own-yard
photo code and physical owner identity passes. The cap audit rejects a 500-card
boundary, an empty model advertising at least 500, and 30 cards against a larger
badge. Separately acquired closing controls retain the existing bounded badge
drift rules. New absolute floors are one third of accepted unique donors, rounded
down. The 50% previous-run and per-yard drift guards are unchanged.

New yard coordinates reuse the saved November 16 Census address matches from the
retry diagnosis. Lake Point uses its yard-published business map point instead.
Each admitted tenant retains its own physical address, location code and website;
no supplier bucket is used as a substitute location.

The combined source has 58,160 accepted donors and a floor of 36,655. Conservative native-VIN overlap bounds leave every physical yard above its floor. A complete full-graph run requires 10,233 native responses and 1,737,146,330 bytes, below the 30,000-request / 8 GiB bounds. Configured response spacing alone costs 7.52 hours; observed response timing estimates 23.90 hours before retry overhead. These are qualification census costs. Daily incremental work is separate and unchanged here.

The fresh ledger records 2,952 requests, including three for the separately qualified [Idaho Falls iPull source](idipull-ingestion.md). Its 568-row census admits 535 unique donors and rejects 33 (5.81%). Intermountain's full-service URG tenant remains excluded. Both sources remain enabled unless their pause flags serve false; no source was enabled, deployed or merged.

`fresh-census-qualification.json` records final outcomes, counts, floors and budget.
`fresh-census-requests.jsonl.gz` records every fresh HTTP attempt with sanitized
headers and response hashes. Admitted `<code>.jsonl.br` archives contain all
opening model pages and independently acquired closing controls in connector
order. `fresh-census-cap-photo.json` records complete model-cap and supplier-photo
checks. `fresh-census-excluded.jsonl.br` preserves rejected or interrupted censuses
and failed response bodies for audit, without admitting their candidate donors.
`fresh-census-bin-proofs.json.br` preserves all four native Norb's NOR6/NOF
parts-page proofs. `lakepoint-bin-proofs.json.br` preserves two independent native
NOF parts pages and their exact supplier scripts. Those two detail-only hashes
verify UU23 and the official domain, with matching MD5 filenames. They are static
qualification proof and are not added to the runtime allowlist. Only blank-VIN,
photo-free cards from explicitly qualified stocks may be excluded. Parts pages
prove generic stock semantics, never a complete donor enumeration. `lakepoint-fresh-supplier-bundle.json.br` preserves the exact new script
and initial stopped controls. Historical retry and batch captures remain intact.

Final lint and typecheck pass. The focused connector, qualification, metadata,
destination, flag and source-validation checks pass 436 tests across 18 files.
After adding explicit required-hash checks, all 13 fresh qualification tests pass
again. Complete Norb's, Lambert and MARS production connector replays pass with
their serialized checkpoints, final accounting and independent closing controls.

The requested `bun test --timeout 15000 src` prints 4,602 passes and zero failures
across 433 files, then exits 143. Every one of those files subsequently passes in
directory chunks, each with exit 0. Final affected checks cover the later tenant
contracts, exact supplier literal and qualification fixtures. No test timeout or
admission threshold was increased.
