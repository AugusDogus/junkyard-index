import { ChevronDown, LockKeyhole } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import type { ArrivalWindow } from "~/lib/arrival-window";
import { SEARCH_RADIUS_MILES } from "~/lib/search-radius";
import type { YardType } from "~/lib/yard-service";
import { Button } from "~/components/ui/button";
import { ArrivalWindowChips } from "./ArrivalWindowChips";
import { SearchYardTypeControls } from "./SearchYardTypeControls";

/** One labeled group in the Filters panel and drawer. */
export function FilterRow({
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
        {/* Reads as a sentence: Within [radius] of [location]. Phones stack
            the two controls full width. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-sm sm:flex sm:flex-wrap">
          <label htmlFor="search-distance-radius">Within</label>
          <div className="relative sm:w-auto">
            <select
              id="search-distance-radius"
              aria-label="Distance radius"
              // Native, for the phone picker, styled like the other controls.
              className="border-rule-strong text-ink bg-background focus-visible:outline-focus h-11 w-full appearance-none rounded-md border pr-9 pl-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 sm:h-9 sm:w-auto"
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
            <ChevronDown
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
            />
          </div>
          <span>of</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 w-full sm:h-9 sm:w-auto"
            onClick={onChooseLocation}
          >
            {locationLabel}
          </Button>
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

/** Opens the advanced search dialog; locked plans see the upgrade there. */
export function AdvancedSearchButton({
  locked,
  ...props
}: { locked: boolean } & ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      className="h-auto min-h-11 self-start px-0 sm:min-h-8"
      aria-label={locked ? "Advanced search, upgrade required" : undefined}
      {...props}
    >
      {locked && <LockKeyhole data-icon="inline-start" aria-hidden="true" />}
      Advanced search
    </Button>
  );
}

/** The last group of the Filters panel and drawer. */
export function AdvancedSearchGroup({
  locked,
  children,
}: {
  locked: boolean;
  /** The entry button, so the drawer can close before the dialog opens. */
  children: ReactNode;
}) {
  return (
    <FilterRow label="Advanced">
      <div className="flex flex-col items-start">
        {children}
        <p className="text-muted-foreground text-xs text-pretty">
          {locked
            ? "Combine terms with AND and OR. Paid plans."
            : "Combine terms with AND and OR across every filter."}
        </p>
      </div>
    </FilterRow>
  );
}
