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

| Source                     | Metadata currently recorded                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| PYP                        | Business/operator, address, phone, coordinates, published store page with relative URLs resolved against the provider              |
| Row52                      | Business, address, phone, coordinates, provider-supplied yard URL; repeated URLs and known chain homepages are omitted             |
| Pull-A-Part / U-Pull-&-Pay | Business/operator, address, phone; ZIP centroid coordinates, undocumented email fields, and generic website links are omitted      |
| AutoRecycler               | Business, address, coordinates from the existing organization cache                                                                |
| U Pull-It Nebraska         | Business/operator, address, phone, coordinates from the store configuration                                                        |
| Tear-A-Part                | Business/operator, address, phone, coordinates from the store configuration                                                        |
| Pull-N-Save                | Verified cached locations plus automatic public-directory lookup for new yard IDs; ZIP centroids are omitted from yard coordinates |
| U Pull It Davie            | Business/operator, coordinates, dedicated yard website                                                                             |
| GO Pull-It                 | Business/operator and coordinates from the location configuration                                                                  |

Missing contact fields remain null. No connector currently has a verified public
contact email. Do not populate that field with operational or employee addresses.
Wrench-A-Part now supplies live yard names, addresses, phones, and coordinates
from its public location endpoint. U Pull R Parts uses the three verified public
locations documented in `upullrparts-ingestion.md`. Neither source substitutes a
chain-wide inventory/contact page for a yard-specific website link.
The directory prefers stored yard-specific websites. It can also recover PYP's
published yard inventory route from an active vehicle URL after validating the
provider host and matching yard code. Pull-A-Part and U-Pull-&-Pay location routes
follow their public location directory, including its `s-carolina` spelling.

When only a verified network entry point is available, the directory labels it
**Provider**, rather than presenting it as a yard-specific website. Independent
business URLs are not guessed from city or yard names. Kiker's URL is matched to
its stable organization ID and verified public Pensacola contact address.

The September 16 read-only coverage check increased displayed website links from
57 to 181 of 205 yards. The remaining 24 AutoRecycler entries have no verified
website in this mapping. Website recovery changes do not alter inventory counts.

## Rollout

1. Apply migration `0007_yard_metadata.sql` before deploying code that queries it.
   Vercel's existing build wrapper runs committed migrations before the build.
2. The next normal ingestion fills yard records. No paid crawl or production
   database change is required during local development.
3. Directory link recovery applies immediately after deployment without a new
   ingestion. PYP's next ingestion also stores its published contact-page URLs.
   The homepage cache version changes with the new website-link payload; normal
   invalidation and the one-hour cache expiry continue to apply.

The migration creates an empty table and preserves all existing inventory.
Rolling back application code can leave the additive table in place.
