# RMMDTP Corinne ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

This connector runs unless its source pause flag serves false. The literal source is `rmmdtp`, the location code is `corinne`, and the qualified minimum is 34 accepted unique donors. The implementation does not register itself or perform production writes.

## Qualified scope

The native operator is Rocky Mountain Medium Duty Truck Parts, `https://rmmdtp.com/`, 2715 North Mule Ranch Circle, Corinne, Utah, 801-781-1015. AL60 independently matched the business point at 41.5556051, -112.12348 and ZIP 84307. The independent map omits the native address's North. The separate Rocky Mountain Truck Parts business in Farr West is outside this source.

UT36 and MT22 independently reproduced the unfiltered `/trucks/` graph: five pages, 106 native cards, 104 Salvage and two Complete. Page 5 contains six cards and no Next or Last control. All five closing pages preserve the opening semantic payloads. The result is 103 accepted unique donors, one required structured-YMM rejection with valid VIN presence, two Complete sale exclusions, zero duplicates and zero conflicts.

The retained source contract uses the title year and labeled Truck Make, Truck Model and Vin Number. Record 145725 publishes Other/Other in its title and structured fields and `2015 KIA SORENTO` in Description. Both claims are retained. Description does not silently replace the structured fields. Composite makes use the existing canonical normalizer without choosing a manufacturer alias. The native 1978 serial `TCE678V579854` remains valid under the existing historical serial contract.

All native labeled card claims, titles, image claims and three detail anchors remain in the checkpoint. Every canonical output field matches the saved UT36 reference. Stock, image and engine metadata are optional. No date, color, position, photo or per-donor detail request is required. Complete means a positively scoped non-donor sale listing, without a roadworthiness claim.

## Traversal and preservation

`streamRmmdtpInventory` accepts a qualified contract, the previous complete unique count (or null), an injected page reader, and callbacks. It traverses the observed Next links serially, then reads every opening URL again. It invokes neither callback until the complete closing graph and quality validation pass. Valid rejected VINs are returned as `observedVins`; clean Complete exclusions do not retain donor presence and can retire during root-owned reconciliation.

The strict versioned cursor has explicit opening, closing, ready and complete phases. It retains typed native pages, verified closing prefixes, semantic hashes, checksum, contract scope and exact request/response-byte accounting. JSON serialization between chunks is supported. Resume validation rejects changed scope, corrupted hashes, reordered pages, inconsistent census, invalid destinations, byte mismatches and contradictory phase state. A complete cursor performs no reads or emission when replayed.

Conflicts in native identity, destination, YMM or donor/Complete condition quarantine the connected records before sale exclusion. All valid quarantined VINs retain presence. Benign identical duplicates are accounted separately; contradictory usable stock, image or engine metadata becomes null. Quality gates remain: minimum 34 accepted, at most 10% required rejects, at most 25% benign duplicates, and the existing shared drift minimum of `floor(previous complete inventory * 0.5)`. Reject and duplicate ratios use non-excluded candidates.

An incomplete, changed, failed or invalid run emits nothing and cannot authorize reconciliation. Retain the last successful checkpoint and prior complete inventory, inspect the saved evidence, then retry from that checkpoint or start a new opening census when the native graph changed. Callbacks must remain idempotent for retries around a failed external write.

## Request bounds

The provider reader allows only exact owned unfiltered inventory URLs, GET, manual redirect handling, HTTP 200 HTML, no content-range, a combined 20-second request/body deadline, and a 2 MiB streaming body cap. It rejects redirects rather than following them automatically. The graph starts at the observed canonical `/trucks/`, avoiding the observed `/trucks` 301. It makes no detail, image, hidden-filter or guessed destination requests.

A module-scoped semaphore preserves a 1.6-second completion gap across chunks and callers, including failed requests. There are no automatic retries. Each chunk accepts one to eight requests and has a three-minute deadline. A whole run is bounded to 800 requests, 128 MiB of response bodies and an 8 MiB serialized checkpoint. This implementation and its fixture checks made no new native HTTP requests.

## Saved checks

Run `bun test src/server/ingestion/rmmdtp-*.test.ts` for exact native canonical replay, serialized one-request chunks, all-page closing stability, no-emission failures, conflict precedence, optional metadata, historical identity, quality limits, request ownership, cancellation, body limits and spacing. The fixture manifest pins all ten exact saved native response bodies.

Qualification seals:

- UT36: `.scratchpad/coverage/parallel-ut-co-ok/rmm-corinne-qualification36/report.json`, SHA-256 `6d2ae755b2bcad79fd5efecefdf3d9a1f6cb0681e8f293bb26db08c32ed8254d`.
- MT22: `.scratchpad/coverage/parallel-mt-wy-nd/rmm-corinne-source-review22/report.json`, SHA-256 `98d02b145f905c2064e189b726fcd60ee9495b4e6c8127a38ea6aff60195c3b0`.
- AL60: `.scratchpad/coverage/parallel-al-ms-la/rmm-corinne-physical271-review60/report.json`, SHA-256 `5282da1fec5ac44df6bd04648601b9e36b8b5458a03048643feac801cba17aad`.

Root owns shared source admission, flags, dispatcher, durable orchestration, registry, validation policy and production reconciliation. Serving false from the source flag pauses ingestion; missing or failed evaluations keep it enabled.
