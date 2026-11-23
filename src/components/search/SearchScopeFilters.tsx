import type { ReactNode } from "react";
import type { ArrivalWindow } from "~/lib/arrival-window";
import { SEARCH_RADIUS_MILES } from "~/lib/search-radius";
import type { YardType } from "~/lib/yard-service";
import { Button } from "~/components/ui/button";
import { ArrivalWindowChips } from "./ArrivalWindowChips";
import { SearchYardTypeControls } from "./SearchYardTypeControls";

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:items-start md:gap-4">
      <span className="text-muted-foreground text-sm md:pt-2">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * When vehicles arrived, how far away, and who pulls the parts. Free on every
 * plan, so these lead the Filters panel and drawer.
 */
export function SearchScopeFilters({
  arrivalWindow,
  onArrivalWindowChange,
  locationLabel,
  onChooseLocation,
  radiusMiles,
  onRadiusChange,
  yardTypes,
  expression,
  onYardTypesChange,
  onEditExpression,
}: {
  arrivalWindow: ArrivalWindow | undefined;
  onArrivalWindowChange(value: ArrivalWindow | undefined): void;
  locationLabel: string;
  onChooseLocation(): void;
  radiusMiles: number | null;
  onRadiusChange(miles: number | null): void;
  yardTypes: YardType[];
  expression?: string;
  onYardTypesChange(types: YardType[]): void;
  onEditExpression(): void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <FilterRow label="Arrived">
        <ArrivalWindowChips
          value={arrivalWindow}
          onChange={onArrivalWindowChange}
        />
      </FilterRow>
      <FilterRow label="Distance">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-9"
            onClick={onChooseLocation}
          >
            {locationLabel}
          </Button>
          <label className="flex items-center gap-2">
            Within
            <select
              aria-label="Distance radius"
              className="bg-background border-input min-h-11 rounded-md border px-3 text-sm sm:min-h-9"
              value={radiusMiles ?? "all"}
              onChange={(event) =>
                onRadiusChange(
                  event.target.value === "all"
                    ? null
                    : Number(event.target.value),
                )
              }
            >
              <option value="all">Any distance</option>
              {SEARCH_RADIUS_MILES.map((miles) => (
                <option key={miles} value={miles}>
                  {miles} miles
                </option>
              ))}
            </select>
          </label>
        </div>
      </FilterRow>
      <FilterRow label="Yard type">
        <SearchYardTypeControls
          types={yardTypes}
          expression={expression}
          onChange={onYardTypesChange}
          onEditExpression={onEditExpression}
        />
      </FilterRow>
    </div>
  );
}
