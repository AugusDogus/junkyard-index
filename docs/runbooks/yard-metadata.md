# Yard metadata

The `yard` table stores business identity, address, coordinates, location website,
phone, and public email under the composite key `(source, code)`. `updated_at`
records when ingestion last observed the metadata. It does not mean that a
provider's cached data was refreshed at that time.

Each connector reports yard metadata separately from vehicle batches. The durable
checkpoint validates it and upserts it in the same transaction as the vehicle
snapshot and cursor. Retries and competing attempts use the same cursor guard.
Metadata does not require a yard to have vehicles, and inventory failures never
delete yard records. A later observed record replaces earlier fields, including
clearing an unavailable contact value.

The homepage joins these records to active inventory by both source and code.
Only yards with active vehicles appear, and vehicle counts keep their existing
meaning. Inventory names and coordinates remain a fallback until metadata exists.
Google Maps searches use the business name and available street address, rather
than treating an inventory ZIP centroid as the yard entrance.

## Coverage

| Source                     | Metadata currently recorded                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| PYP                        | Business/operator, address, phone, coordinates, matching location inventory page                                              |
| Row52                      | Business, address, phone, coordinates, provider-supplied yard URL; repeated URLs and known chain homepages are omitted        |
| Pull-A-Part / U-Pull-&-Pay | Business/operator, address, phone; ZIP centroid coordinates, undocumented email fields, and generic website links are omitted |
| AutoRecycler               | Business, address, coordinates from the existing organization cache                                                           |
| U Pull-It Nebraska         | Business/operator, address, phone, coordinates from the store configuration                                                   |
| Tear-A-Part                | Business/operator, address, phone, coordinates from the store configuration                                                   |
| Pull-N-Save                | Business/operator, address, coordinates from the configured public yard directory                                             |
| U Pull It Davie            | Business/operator, coordinates, dedicated yard website                                                                        |
| GO Pull-It                 | Business/operator and coordinates from the location configuration                                                             |

Missing contact fields remain null. No connector currently has a verified public
contact email. Do not populate that field with operational or employee addresses.
Do not derive location URLs from vehicle URLs or substitute a shared company
homepage. Add provider-backed location links when they become available.

## Rollout

1. Apply migration `0007_yard_metadata.sql` before deploying code that queries it.
   Vercel's existing build wrapper runs committed migrations before the build.
2. The next normal ingestion fills yard records. No paid crawl or production
   database change is required during local development.
3. The directory uses inventory fallback data until that ingestion runs. Existing
   homepage cache invalidation applies; the cache also expires after one hour.

The migration creates an empty table and preserves all existing inventory.
Rolling back application code can leave the additive table in place.
