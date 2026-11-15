# Source validation

Every source's snapshot is checked in
`src/server/ingestion/source-validation.ts` before its run reconciles it. A
rejected snapshot leaves the source's previously published inventory in place.
A source with no accepted run goes stale on `/api/status/<source>` 30 hours
after its last accepted publication.

## Inventory age

A source is rejected when its newest vehicle arrived longer ago than its age
limit, measured from the run's start. The newest date ignores missing,
unparseable, and future-dated (more than a day ahead) `availableDate` values. A
snapshot where no vehicle has a usable date skips the check.

The limit is 30 days unless `INVENTORY_AGE_LIMITS` overrides it, next to the
minimum inventories in the same file. All sources on `main` use the default. This
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
search after three reconciled runs or three days. A source that still lists one
of its VINs takes that VIN over.

Keep a retired source in `INGESTION_SOURCES` so its stored rows still parse and
its status keeps reporting stale. To restore it, remove it from the retired list.
