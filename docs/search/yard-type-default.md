# Search yard types

A `/search` URL without a valid yard-type value defaults to self-service. The
default is the absence of `yardTypes`: the search page writes plain `/search`
for its default state and never serializes the self-service default. Only a
non-default yard scope appears in the URL.
The `SearchYardSelection` union distinguishes `default`, an `explicit` facet list,
and an `expression` that owns its yard-type conditions.
Self-service includes yards that offer both service types. Yard type is available
on every plan, inside the Filters panel (desktop) and drawer (phones).

Explicit selections use repeated `yardTypes[]` parameters. `yardTypes=all` (also
accepted as `yardTypes[]=all`) means no restriction, including unclassified yards.
Clearing both filters writes `all`, so reloads cannot reapply the default.
Links that still carry `yardTypes[]=self_service` select the default and lose
the parameter on the next URL write. `SearchYardSelection.isImplied` decides
whether a selection needs a URL value: the self-service default and
expression-owned types do not.
The three yard-type controls are toggle buttons, styled like the arrival
window chips. The unrestricted state has its own "All yards" control, named
"All yards, including unclassified" for assistive technology. Only that control
is pressed for `all`; selecting both known types presses the two service
controls instead, and releasing both returns to `all`.

The default scope is not a filter. It adds nothing to the Filters count and
shows no chip. Any other scope shows one removable chip ("Full-service
included", "Full-service only", "All yards"); removing it, or Clear all,
returns to the default. Any chip makes the search active, so all yards with
nothing else shows every yard's results, as its chip says.

With zero results, recovery only widens the search. "Clear filters" drops the
other filters and keeps the current yard scope, and appears only when another
filter is active. "Include all yards" appears whenever the scope is narrower
than all yards, including the self-service default.

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
needed. `buildSearchUrl` serializes persisted criteria: absent or empty types
become `yardTypes=all`, and a saved self-service-only selection opens as the
default URL with no parameter.

Self-service-only results request one additional yard-type facet count in the
same Algolia multi-query batch. This preserves the query, VIN/expression filters,
other facets, numeric filters and geo parameters. It counts full-service matches
that do not also have self-service, avoiding duplicates from both-type yards.
The number counts vehicles, not distinct yards. With fewer than 3 self-service
vehicles, an empty-state-style message offers recovery. At 3 or more, one quiet
line follows the count ("Also N at full-service yards. Show them"). Zero extra
matches produces no suggestion.
"Show them" selects both types in one state update and writes both URL values.
It never changes selections automatically. After expansion returns, keyboard
focus moves to the results count and scrolls it into view. A persistent polite
status announces the updated count and inclusion of full-service yards.

Yard, state, chain, make and model pages, homepage arrivals, and the map keep all
types. Search metadata, robots rules and canonicals are unchanged.
