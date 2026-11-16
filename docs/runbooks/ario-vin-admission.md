# Ario VIN admission

New yards use `inventoryVinWithCheckDigit`, preserving supported pre-1981 serials.
Failures increment recorded rejections. CFC now accepts 395 of 422 rows and rejects
27 (6.40%), including twelve newly detected check-digit failures. The 10% guard,
50% drift guard and request budget are unchanged.

The original 20 migrated yards retain their existing `inventoryVin` behavior.
Their saved feeds contain 326 check-digit failures among 22,081 structurally
accepted active-item candidates, including 62 in stale Santa Maria. Among the
19 currently fresh yards, 264 of 18,805 accepted candidates fail. Shelby is the
largest potential change (121/1,315, 9.20%). Existing provider output is preserved
under the owner rule; broader cleanup is a separate rollout decision. Santa
Maria remains stale and publishes none of its candidates.

Saved fixture audit below counts active API items before freshness selection;
"after check digits" is hypothetical for the original 20 and enforced for CFC.
No live provider requests were made for this audit.

| Yard                               | Existing accepted | Additional check-digit rejects | Accepted after check digits | Total rejects after check digits |
| ---------------------------------- | ----------------: | -----------------------------: | --------------------------: | -------------------------------: |
| a-a-auto-recycling                 |              1134 |                              2 |                        1132 |                                5 |
| auto-parts-u-pull-nc               |               839 |                              2 |                         837 |                                2 |
| auto-parts-u-pull-shelby-nc        |              1315 |                            121 |                        1194 |                              121 |
| ez-pull-n-pay-atlanta              |              1043 |                             10 |                        1033 |                               34 |
| ez-pull-n-pay-birmingham           |               725 |                              2 |                         723 |                               15 |
| ez-pull-n-pay-columbus             |               940 |                              5 |                         935 |                               15 |
| ez-pull-n-pay-decatur              |              1010 |                             13 |                         997 |                               20 |
| ez-pull-n-pay-montgomery           |              1078 |                             27 |                        1051 |                               52 |
| ez-pull-n-pay-stockbridge          |              1104 |                              6 |                        1098 |                               12 |
| ez-pull-n-pay-warner-robins        |              1158 |                              6 |                        1152 |                               10 |
| foss-havelock                      |               504 |                              7 |                         497 |                               11 |
| foss-jacksonville                  |              1137 |                             29 |                        1108 |                               55 |
| foss-la-grange                     |               968 |                              7 |                         961 |                               10 |
| foss-recycling                     |               761 |                              0 |                         761 |                                2 |
| foss-wilson                        |               713 |                              6 |                         707 |                               16 |
| foss-winston-salem                 |              1343 |                              0 |                        1343 |                                1 |
| l-and-l-u-pull                     |              1445 |                             18 |                        1427 |                               38 |
| prestige-pull-your-part-houston-tx |              1305 |                              2 |                        1303 |                               47 |
| samson-auto-salvage                |               283 |                              1 |                         282 |                               13 |
| santa-maria-recycling-center       |              3276 |                             62 |                        3214 |                               82 |
| cfc-recycling                      |               407 |                             12 |                         395 |                               27 |
