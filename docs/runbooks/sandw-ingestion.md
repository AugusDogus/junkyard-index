# S&W Automotive Parts

The disabled `sandw` source covers S&W U-Pull, U-Save at 1826 Lithonia Industrial Blvd, Lithonia, Georgia 30058. S&W's U-Pull and Full Service branches are one provider. Only this qualified Georgia catalog earns a provider/state credit.

The native [yard page](https://www.sandwauto.com/locations/u-pull) and [searchable inventory](https://www.sandwauto.com/inventory-search) bind the catalog to that physical yard. The published client fetches `/api/inventory/vehicles` as one complete array. Filtering and Show More operate locally. There are no donor detail URLs, so search cards, emails and notifications direct users to VIN/stock matching in the real inventory search.

The November 15 UTC live connector run accepted all 624 donors with zero required rejects, duplicates or identity conflicts. Opening and closing reports were byte-identical. The report explicitly says `stale`, with `lastSyncedAt=2026-11-02T12:02:06.000Z`. This qualifies the complete currently published catalog, without claiming a fresh upstream synchronization. The connector and soak retain that warning, durable collection logs it, and destination guidance asks users to confirm availability.

The collector makes five serial, bounded GETs: owner, inventory scope, complete report, closing report and closing owner. It emits only after closure. Checkpoints preserve resumable stages and validate scope/checksum. Unexpected pagination, owner/identity drift, malformed responses and HTTP failures abort. There are no automatic retries or redirects.

The source keeps the existing 10% rejection, 25% duplicate and 50% previous-count limits, a census-grounded minimum of 500, rejected valid VIN presence, and native stock/VIN conflict checks. Optional values remain nullable. Coordinates come from an exact Census address match and represent an address-range point.

Local checks passed: 393 tests covering native replay and shared cursor, terminal validation, flags, reconciliation, destinations and provider counting; repository typecheck; scoped lint and formatting. Evidence, request receipts and local admission are under `.scratchpad/provider-coverage/nov14-provider-goal/`, including `research/ga_fl_al/refill/sandw-live-verification.json`, `sandw-local-admission.json` and `sandw-application-tests.log`.

Read-only verification command:

```sh
bun run soak:sources -- --sources=sandw --cycles=1 --max-pages=5
```

The source defaults off. No source enablement or production writes were performed.
