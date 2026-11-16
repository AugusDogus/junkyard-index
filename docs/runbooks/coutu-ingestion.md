# Coutu ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

The `coutu` provider is Truck Country's own donor inventory at
`https://www.truckcountry.us/browse`. The native site identifies Truck Country,
1535 W Main St, Willimantic, CT 06226, phone 860-423-6004. Its homepage describes
the Willimantic work truck parts yard. Coutu is the provider identifier, not an
invented public business alias.

The qualified named business point is 41.7189312, -72.2349279 (Google place ID
`ChIJ8x0xA09j5okRZ1O_HW2ewV4`), with matching native address, domain and phone.
Coordinate accuracy is unstated.

The connector follows the literal make and model controls, then reads the
server-rendered `Browse by Vehicles` cards on every published model page. Native
`in stock` category badges count parts and are never donor denominators. The
homepage's featured parts feed is not a donor surface. The connector fetches no
donor details, component categories, scripts, photos or synthesized browse paths.

Each chunk permits 1 through 8 serial GETs. Requests have no retry, a 20-second
combined request/body deadline and a streaming 2 MiB UTF-8 limit. Production
requests wait 1.6 seconds after completion, including failure. A chunk has a
three-minute deadline; a run allows at most 1,024 GETs. Redirects, partial bodies,
foreign MIME, changed ownership, truncation and any native continuation controls,
including numeric pagination, fail closed.

The checksummed versioned checkpoint retains all raw required native claims,
including valid VINs from rejected rows. Its 1 MiB bound, request accounting,
contiguous graph prefix and model bindings are checked before resume. Paused
chunks emit no vehicles, yards, VIN presence or terminal accounting. Never edit
a checkpoint to skip a failed control. Preserve the previous inventory and use
the last validated checkpoint. A changed graph or closing control requires
inspection and a fresh traversal from the native homepage.

Before emission, the connector rereads native ownership, the make directory,
every model directory, and the first and last model lists. This bounds graph
changes during traversal; it does not establish an atomic catalog instant.
Global reconciliation quarantines every occurrence of a VIN with conflicting
year, make, model or donor destination. A destination claimed by multiple valid
VINs quarantines all those identities. No native claimant wins. Required rejects
with valid VINs remain in terminal `observedVins`. Accepted VINs are represented
by their emitted donors. Optional stock/photo disagreements become null.

The actual `inventoryVin` helper accepts supported historical serials. In
particular, native `1969 INTERNATIONAL INTERNATIONAL`, serial `383208H879516`,
retains the native model `INTERNATIONAL`. No VIN decoding or URL slug rewrites
native make/model claims.

Validation requires at least 418 accepted donors, at most 10% required rejects
and at most 25% benign duplicates. Terminal accounting must satisfy
`raw = accepted unique + duplicates + required rejects`, with no exclusions.
The saved November 12, 2026 finite census is 11 makes, 74 models and 1,435 raw
cards: 1,254 accepted unique donors, 59 benign duplicates and 122 required
rejects. There are 1,287 distinct valid VIN identities, including 33 quarantined
groups. These are replay expectations, not hardcoded live inventory counts.

`scripts/soak-coutu.ts` exports `soakCoutuInventory(runChunk, maxRequests,
chunkRequests)`. It counts and discards caller-owned chunk results, checks
resume progress and emits no external writes. Transport, source admission,
staging and publication remain the caller's responsibility.

Run focused checks with:

```sh
bun test src/server/ingestion/coutu-*.test.ts
bun run typecheck
bunx oxlint src/server/ingestion/coutu-*.ts scripts/soak-coutu.ts
bunx oxfmt --check src/server/ingestion/coutu-*.ts scripts/soak-coutu.ts docs/runbooks/coutu-ingestion.md
```

Saved-only evidence is under
`.scratchpad/coverage/parallel-ak-hi/coutu-finite-model-census28`, the independent
terminal review under
`.scratchpad/coverage/parallel-ma-ct-ri/coutu-terminal-independent-review01`, and
the independently corrected canonical/destination oracle under
`.scratchpad/coverage/parallel-mt-wy-nd/coutu-destination-conflict-review01`.
Do not dispatch live requests from the replay. Live source checks require the
shared provider claim and current source-coordinator authorization.
