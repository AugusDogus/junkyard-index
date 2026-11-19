# Public vPIC identity responses

`identities.json` contains four unmodified result objects from the live,
read-only production-pattern sample on 2026-11-18. Requests used the public
`DecodeVINValuesBatch` endpoint, 50 VINs per POST, serially with a generic
User-Agent. These are public vehicle identity fields, without credentials or
project/owner metadata. Tests replay this file and never contact vPIC.

`consumer-identities.json` contains selected, unmodified identity fields from
eight additional public sample responses, plus separate expected consumer
names. It retains Model, Series, Series2, Trim, DriveType and
ElectrificationLevel for C1500/K1500, Silverado 1500/2500, Civic Hybrid,
F-250 Super Duty, S-10 and Astro regressions. Omitted vPIC fields are unrelated
to identity resolution. Tests replay these excerpts without live requests.

`review-identities.json` records the clean Express and Toyota/Scion responses
from the independent review. `consumer-sample-400.json` keeps five fields from
each reviewed sample record as tuples: decoded make, decoded model, series,
source make and source model. Property tests replay all 400 and compose every
source alias against matching sampled families. These are public identity
fields; no live calls are made by tests.
