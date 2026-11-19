# Search yard types

A shared `/search` URL without a valid yard-type value defaults to self-service.
The `SearchYardSelection` union distinguishes `default`, an `explicit` facet list,
and an `expression` that owns its yard-type conditions.
Self-service includes yards that offer both service types. Yard type is available
on every plan and remains visible above the results.

Explicit selections use repeated `yardTypes[]` parameters. `yardTypes=all` (also
accepted as `yardTypes[]=all`) means no restriction, including unclassified yards.
Clearing both filters writes `all`, so reloads cannot reapply the default.
InstantSearch serializes the effective default as an explicit self-service value.
The unrestricted state has its own "All yards" control, named "All yards,
including unclassified" for assistive technology. Only that control is pressed
for `all`; selecting both known types presses the two service controls instead.

A parsed `yardType` term anywhere in an expression suppresses the implicit
self-service facet. The expression retains its Boolean matching, including OR
branches without a yard-type term. Quoted text that resembles a field does not
suppress the default. Explicit URL facets still apply alongside the expression.
Expression-owned yard types are labeled "Yard types set in advanced search" with
an edit action; any additional explicit facets remain separately visible.

Persisted searches keep the existing `yardTypes` array. New searches save their
effective selection, including the self-service default. Missing or empty saved
arrays retain legacy all-type semantics, including when edited, opened, or linked
from alerts. Alert matching does not apply the new URL default. No migration is
needed. `buildSearchUrl` serializes persisted criteria, so absent types become
`all`; fresh shared links may simply omit the parameter.

Self-service-only results request one additional yard-type facet count in the
same Algolia multi-query batch. This preserves the query, VIN/expression filters,
other facets, numeric filters and geo parameters. It counts full-service matches
that do not also have self-service, avoiding duplicates from both-type yards.
The number counts vehicles, not distinct yards. With fewer than 3 self-service
vehicles, an empty-state-style message offers recovery. At 3 or more, a compact
hint appears below the results. Zero extra matches produces no suggestion.
"Show them" selects both types in one state update and writes both URL values.
It never changes selections automatically. After expansion returns, keyboard
focus moves to the results count and scrolls it into view. A persistent polite
status announces the updated count and inclusion of full-service yards.

Yard, state, chain, make and model pages, homepage arrivals, and the map keep all
types. Search metadata, robots rules and canonicals are unchanged.
