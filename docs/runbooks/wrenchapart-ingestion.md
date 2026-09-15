# Wrench-A-Part ingestion

Source: `wrenchapart`. Yard identity and metadata come from the provider, not a
fixed allowlist. No provider credentials are required.

## Public API

- `GET https://api.wrenchapart.com/locations`
- `GET https://api.wrenchapart.com/v1/vehicles?locationId=<id>`
- `GET https://api.wrenchapart.com/v1/vehicles` can cross-check the union of yards.

All responses are bare arrays. The client rejects HTTP 206, Content-Range, or
Link headers. The connector verifies that every vehicle belongs to the requested
yard before emitting it. An empty or duplicate-ID location directory fails.

September 15 verification found seven yards and 11,460 vehicles. Each filtered
response exactly matched that yard's portion of the global catalog. The provider
has no independent total or snapshot token; repeat that comparison if inventory
drops or the public interface changes.

## Checkpoints and metadata

- Initial cursor: `{ "source": "wrenchapart", "afterLocationId": 0 }`.
  Resume by completed yard ID, never array position. One complete yard per
  durable chunk; cursor advancement follows successful callbacks.
- Newly discovered higher IDs join the current run. Lower IDs appear next run.
  An ID missing entirely from the directory cannot be discovered through it.
- No within-yard pagination is verified. The largest measured yard had 2,400
  vehicles: roughly 967 KB raw and 1.63 MB of canonical batch JSON. Check actual
  persistence costs before increasing chunk size.
- Requests start at most once every 1.1 seconds. Shared validation requires at
  least 9,000 vehicles and applies drift, rejection, and duplicate checks.
- Yards missing required location metadata produce counted warnings and observed
  VINs, protecting previously known vehicles through the shared observation path.
- Coordinates, addresses, and phones come from `/locations`. Vehicle links use
  `https://wrenchapart.com/vehicle-search.html`; prices use validated provider slugs
  in `https://wrenchapart.com/<slug>-price-list.html`. No yard-specific website or
  VIN deep link is inferred.
- Short provider VIN identifiers are preserved under existing ingestion rules;
  characters are not guessed or padded.

## Local verification

```sh
bun run soak:sources -- --sources=wrenchapart --max-pages=1
bun run soak:sources -- --sources=wrenchapart --cycles=1
bun test src/server/ingestion/wrenchapart-client.test.ts src/server/ingestion/wrenchapart-transform.test.ts src/server/ingestion/wrenchapart-connector.test.ts
```

The full read-only soak returned 11,460 vehicles in eight requests, about nine
seconds, with no warnings/errors. Production uses separate yard checkpoints;
the soak counts and discards batches without publishing inventory or alerts.
