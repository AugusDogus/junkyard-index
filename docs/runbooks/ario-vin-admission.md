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

## Additional native yards in #168

The twelve subsequent yards also require check-digit validation. Their saved
13,280 rows now yield 12,970 accepted and 310 rejected (162 additional rejections).
Every yard remains below 10%; Roberts is highest at 8.23%. CFC and all twelve
additions together accept 13,365 donors, and the full fresh Ario replay accepts
32,170. No enablement flag was introduced. No live provider requests were made.

| Yard                                     | Previous accepted | Additional check-digit rejects | Accepted | Rejected | Rejection rate |
| ---------------------------------------- | ----------------: | -----------------------------: | -------: | -------: | -------------: |
| cash-n-carry-pull-your-part-savannah-ga  |               680 |                             11 |      669 |       38 |          5.37% |
| wilberts-u-pull-it-williamson-ny         |              2594 |                              1 |     2593 |        4 |          0.15% |
| youngstown-u-pull-it-youngstown-oh       |              1524 |                             25 |     1499 |       58 |          3.73% |
| barry-s-u-pull-it-theodore-al            |               684 |                              0 |      684 |        1 |          0.15% |
| roberts-parts-u-pick-moffett-ok          |              1228 |                             69 |     1159 |      104 |          8.23% |
| parts-you-pull-amite-la                  |               473 |                              1 |      472 |        9 |          1.87% |
| wilberts-u-pull-it-elma-ny               |              1322 |                              0 |     1322 |        3 |          0.23% |
| baughmans-u-pull-it-york-pa              |              1099 |                             12 |     1087 |       33 |          2.95% |
| a-1-crashed-cars-south-sioux-city-ne     |              1121 |                              9 |     1112 |       12 |          1.07% |
| wilberts-u-pull-it-bath-ny               |              1116 |                              0 |     1116 |        0 |          0.00% |
| milliron-auto-parts-mansfield-oh         |               695 |                             29 |      666 |       35 |          4.99% |
| smith-auto-inc-self-serve-pawnee-city-ne |               596 |                              5 |      591 |       13 |          2.15% |
