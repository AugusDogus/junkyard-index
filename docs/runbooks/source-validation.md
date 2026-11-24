# Source validation

Every source's snapshot is checked in
`src/server/ingestion/source-validation.ts` before its run reconciles it. A
rejected snapshot leaves the source's previously published inventory in place.
A source with no accepted run goes stale on `/api/status/<source>` 36 hours
after its last accepted inventory publication (its cadence plus 12 hours for a
source crawled less often than daily, such as U Pull R Parts).

## Inventory age

A source is rejected when its newest vehicle arrived longer ago than its age
limit, measured from the run's start. The newest date ignores missing,
unparseable, and future-dated (more than a day ahead) `availableDate` values. A
snapshot where no vehicle has a usable date skips the check.

The limit is 30 days unless `INVENTORY_AGE_LIMITS` overrides it, next to the
minimum inventories in the same file. Qualified exceptions are listed below. This
check caught U Pull-It Nebraska's TAP feed, which kept answering with real VINs
for months after the yards stopped updating it.

When you add a slow-turnover source, set its limit. Heavy-truck yards and small
full-service yards with only a few donor vehicles can go months without a new
arrival. Use the provider's real arrival history to choose the limit:

```ts
const INVENTORY_AGE_LIMITS = {
  examplesource: { kind: "days", days: 180 },
  // Only when the provider's dates do not reflect arrivals at all:
  otherexample: { kind: "unchecked" },
};
```

Prefer a longer limit over `unchecked`, so a frozen feed is still caught
eventually. Do not raise a limit to accept a feed that has stopped updating.
Retire it instead.

## Retired sources

`RETIRED_INGESTION_SOURCES` in `src/lib/ingestion-source.ts` lists sources whose
feed no longer reflects the yards' inventory. A retired source is never
scheduled, whatever its Vercel flag serves. The manual run route refuses it with 409.

Every run reconciles a retired source as if it had accepted an empty snapshot of
it. Its vehicles are marked missing, then deleted from the database and from
search once they have been missing for 72 hours. A source that still lists one
of its VINs takes that VIN over.

Keep a retired source in `INGESTION_SOURCES` so its stored rows still parse and
its status keeps reporting stale. To restore it, remove it from the retired list.

## Provider-stack age audit (November 18, 2026)

Audited the 94 sources at `062f20c8` using committed fixtures, saved complete
canonical replays and the qualification packets cited by each source runbook.
No provider requests were made. Qualification dates, rather than today's date,
are the comparison baseline. Reduced parser fixtures are not complete censuses.
In particular, the reduced Meeks/Rightway fixtures have old dates, whereas their
complete qualified replays end on November 12/9 respectively.

### Explicit limits

These sources had a newest accepted arrival more than 20 days old at
qualification. Each gets **60 days**, matching the provider-coverage currency
window, rather than assuming weekly turnover. This still rejects a frozen
snapshot eventually. The default remains **30 days**.

| Source      | Newest accepted arrival | Qualification (UTC)     | Age       | Complete saved evidence under `.scratchpad/coverage/`, unless noted                                                                               |
| ----------- | ----------------------- | ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alln1`     | 2026-10-19              | 2026-11-12 07:23        | 24.3 days | `parallel-az-nm-nv/alln1-plan/evidence/replay-vehicles-budget3.json`, 1,093 donors; `alln1-local-admission.json`; [runbook](alln1-ingestion.md)   |
| `aviation`  | 2026-10-22              | 2026-11-12 15:24        | 21.6 days | `parent-aviation-replay/actual-canonical-vehicles.json`, 2,326 donors; `aviation-local-admission.json`; [runbook](aviation-ingestion.md)          |
| `chaz`      | 2026-10-23              | 2026-11-12 20:21        | 20.8 days | `parent-chaz/canonical-vehicles.json`, 1,063 donors; `chaz-local-admission.json`; [runbook](chaz-ingestion.md)                                    |
| `aplus`     | 2026-10-23              | 2026-11-13 01:00        | 21.0 days | `parent-aplus-final11/canonical-vehicles.json`, 1,222 donors; `aplus-local-admission.json`; [runbook](aplus-ingestion.md)                         |
| `pratt`     | 2026-10-23              | 2026-11-13 06:32        | 21.3 days | `parent-pratt-final01/canonical-vehicles.json`, 5,931 donors; `pratt-local-admission.json`; [runbook](pratt-ingestion.md)                         |
| `oemgarage` | 2026-10-26              | 2026-11-15 04:10 onward | 20.2 days | Committed `oemgarage-test-fixtures/opening.json.gz` and `native.json.gz`: 239 accepted of 258; `Arrived` field; [runbook](oemgarage-ingestion.md) |

### Rejected frozen sources

`upullitne` keeps 30 days and remains retired. Its newest August 5 arrival at
the November 15 diagnosis is 101 days old. Its vehicles are withdrawn by the
retired-source path below.

`brandywine` also keeps 30 days, with **no exception and no retirement**. The
complete committed `brandywine-test-fixtures/reference.json.gz` oracle has 1,807
accepted donors, all dated, newest **2020-09-11**, against November 12-13, 2026
qualification (about 2,254 days). Do not use the newer September 17 date from
`canonical-helper-output.json`: that intermediate includes inactive/excluded
stocks. The accepted oracle is authoritative. The owner confirmed that this
source should reject and that its rejection does not block release.

The native detail label **`Inventory Date:`** maps through
`extractBrandywineDetail`'s `sourceDate` directly to `availableDate`. For example,
stock `08C251`, VIN `3GNGC26R4XG154716`, has `Inventory Date: 2020-09-11` in its
saved native detail. The label does not say arrival, acquired, or set-in-yard.
The fixtures establish a provider inventory-record date, but do not establish
whether it means physical arrival, listing creation, or another operation. No
HTTP capture timestamp, model year or page update is substituted for it.

A rejected source is **not** a retired source. Rejection preserves its existing
`vehicle` rows, yard summaries and search records; it does not mark them missing
or queue deletions. Thus Brandywine inventory published before this guard stays
published after its next rejected run. Its accepted-publication freshness stops
advancing and becomes stale after 36 hours. Other sources can still replace
individual VINs under the existing ownership rules. This PR changes none of
that behavior. A later decision to withdraw the source would require retirement
or another explicit withdrawal action.

### Multi-yard findings

The guard computes one newest date across the complete **source** snapshot.
It does not reject individual yards. Existing per-yard admission/quarantine is
retained independently; preserved URG and AutoRecycler yards are still excluded
from missing/deletion reconciliation.

- `midway`: Muncie (`MO38`, 419 donors) and Liberty (`MO09`, 344) both end on
  October 23, 20.2 days before their November 12 qualification. The November 15
  Tulsa (`OO95`) committed full replay has 1,064 donors through November 14.
  The combined source therefore keeps 30 days. See [Midway](midway-ingestion.md).
- `urgiis`: Eagle's newest accepted date is October 1 (45+ days at
  qualification). Other dated tenants are Chucks November 10, Higgins
  November 15, Lambert November 12 and Stroud November 13. The source newest is
  November 15. Linders, Chuckran, Ace St Paul and Norbs have no parseable
  arrivals. These are the 9 configured tenants after the November 23 cut of
  the 11 Cloudflare-blocked full-service tenants. No age exception is needed. Full saved connector replay, including recovered model routes,
  confirms these dates. See [URG](urgiis-ingestion.md) and [batch B](urgiis-batch-b.md).
- `autorecycler`: the saved eligible Ario customer snapshots end November 2-14,
  except Colorado Auto & Parts, October 7 (41 days on November 17). Colorado
  passes the source-wide 30-day guard because other yards are fresh; its existing
  60-day yard freshness check still applies. Santa Maria's August 24 feed is
  already excluded by that yard check. The legacy JDM/A-1 replays end November
  13/2. [Ario qualification](provider-coverage-multistate.md) and committed
  `fixtures/ario/*.json.gz` retain the per-yard complete windows.
- `hollanderstores`: all configured yards, including the latest Rowland,
  Midvale, Paradise and Waugh additions, emit `availableDate: null`. Record IDs,
  stock prefixes, part acquisition dates and photo timestamps used for currency
  qualification are not promoted to arrival dates. The guard skips these
  snapshots. See [Hollander](hollanderstores-ingestion.md).
- `heavytruckparts` (all five stores), `cstruck`, `dutchers` and `vanderhaags`
  (all configured physical yards) also emit no arrival dates. Their slow truck
  turnover therefore needs no numeric override.
- `chesterfield` retains native arrival dates for all three yards. The saved
  November 11 newest-car controls include new November 11 set dates, so its
  source-wide newest is within one day of qualification. See
  [Chesterfield qualification](chesterfield-inventory-qualification.md).
- Other dated multi-yard sources retain the 30-day default: `fenix`'s four yards
  end November 10-11; `pickers` Texarkana/Longview/Reno November 10/13/11; Utah
  Pic-A-Part (`utpap`)'s two yards November 7/8; Pull & Save WA (`pullsavewa`)'s two yards November 11;
  Pick-A-Part VA (`pickapartva`)'s two yards November 10/11; `harrys`' three yards November 12-13;
  `byot`'s five yards November 11-14; `vinplus`'s seven yards have November arrivals.
  Their committed replay evidence and source runbooks retain yard identities.

### Remaining source coverage

The remaining dated sources keep 30 days: `aero` (November 9), `rightway`
(November 9), `meeks` (November 12 after 739 optional-date conflicts are nulled),
`calton` (November 9), `idipull` (November 13 in the complete committed
`fixtures/idipull-census.json.gz` replay, qualified November 14), `chasencars` (November 8), `denton` (November 13),
`indianriver` (November 12), `lonestarimports` (November 13), `allied`
(November 10), `alsauto` (November 6), `sandw` (October 31 at November 15
qualification), `joliet` (November 14), `littleton` (November 10 in the complete
replay), `grandpajohns` (November 15), `pipes` (November 10 in the complete
replay), `uwrench` (November 9), `nvpap` (November 10), `weberbrothers` (November 15; native Arrival Date), and `budget`
(November 13). The complete saved qualification outputs, rather than reduced
old-date test samples, supply these maxima. `oem` has 2,158 accepted donors, newest November 13, in the saved
`provider-coverage/nov14-provider-goal/research/oh_mi_wi/refill02/oem-final-cursor.json`
model/arrival union. Weber Brothers has 5,760 accepted donors, newest November 15,
in the complete saved `research/pa_md_wv/evidence/weber-census/catalog.json`
and `weber-details/progress.sqlite` detail replay. Both are within 20 days of
their November 15-16 qualification. `pontiac` retains the provider's `YardLocationDT` set-in-yard date in the qualified
arrival/search union.

The pre-stack dated connectors `row52`, `pyp`, `pullapart`, `upullitdavie`,
`gopullit`, `pullnsave`, `tearapart`, `wrenchapart`, `upullrparts`, `ipullupull`,
`upullitwa`, `partsgalore`, and `rtp` retain their provider date mappings and
30-day defaults. Their historical protocol fixtures must be compared with
their own capture dates, not the November provider-stack qualification date.
No arrival date is synthesized from a crawl timestamp.

Every other registered source emits no arrival date and skips this check:
`tritown`, `whitebradstreet`, `ddauto`, `rivervalley`, `importapart`, `army`,
`bigd`, `michigantruck`, `millerstown`, `mccauley`, `rustyhook`, `citymotors`,
`awap`, `clearsalvage`, `central`, `northwest`, `coutu`, `kodak`, `six03`,
`rohner`, `cars4parts`, `rmmdtp`, `bigtruckpage`, `speedys`, `beavers`, `scotts`,
`hawaiiparts`, `modernmuscle`, `carsandparts`, `spartan`, `hagerman`, `kandr`,
`jimsimport`, `alshned`, plus the undated multi-yard truck/Hollander sources
listed above. Keep their ordinary count, drift, identity and terminal guards.
