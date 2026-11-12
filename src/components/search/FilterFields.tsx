import Link from "next/link";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "~/components/ui/field";
import { Slider } from "~/components/ui/slider";
import { PLANS } from "~/lib/plans";
import type { DataSource } from "~/lib/types";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import { cn } from "~/lib/utils";

const SOURCE_LABELS: Record<DataSource, string> = {
  pyp: "Pick Your Part (PYP)",
  pullapart: "Pull-A-Part / U-Pull-&-Pay",
  upullitne: "U Pull-It (NE/IA)",
  upullitdavie: "U Pull It Davie",
  gopullit: "GO Pull-It",
  pullnsave: "Pull-N-Save",
  tearapart: "Tear-A-Part",
  wrenchapart: "Wrench-A-Part",
  upullrparts: "U Pull R Parts",
  ipullupull: "iPull-uPull",
  upullitwa: "Washington U-Pull-It",
  partsgalore: "Parts Galore",
  rtp: "RTP Pick-A-Part",
  nvpap: "Nevada Pic-A-Part",
  pontiac: "U-Pull and Save Pontiac",
  chesterfield: "Chesterfield Auto Parts",
  utpap: "Utah Pic-A-Part",
  tritown: "Tri Town Auto Salvage",
  whitebradstreet: "White & Bradstreet",
  midway: "Midway U Pull",
  rightway: "Rightway Auto Recycling",
  ddauto: "DD Auto & Salvage",
  rivervalley: "River Valley Truck Parts",
  fenix: "Fenix U-Pull",
  importapart: "Importapart",
  bigtruckpage: "BigTruckPage",
  denton: "Denton Auto Parts",
  beavers: "Beaver's Car Salvage",
  indianriver: "Indian River U-Pull-It",
  oem: "OEM Auto Recyclers",
  dutchers: "Dutcher's Inc. Heavy Truck Division",
  chasencars: "Chase N Cars",
  oemgarage: "oeM Garage",
  hagerman: "Hagerman",
  kandr: "K&R Truck Parts",
  jimsimport: "Jim's Import Auto Salvage",
  army: "Army's Auto Wrecking",
  idipull: "Idaho Falls I-Pull",
  pullsavewa: "Pull & Save Washington",
  littleton: "Littleton U-Pull-It",
  michigantruck: "Michigan Truck Parts",
  joliet: "Joliet U-Pull-It",
  alln1: "All-N-1 U Pull",
  pickers: "Pickers Texarkana",
  pipes: "Pipes U-Pull-It",
  uwrench: "Tri-State U-Wrench & Save",
  millerstown: "Millerstown Pic-A-Part",
  pickapartva: "Pick-A-Part Virginia",
  mccauley: "McCauley's Auto",
  rustyhook: "Rusty Hook Auto Salvage",
  aviation: "Aviation Auto Salvage",
  chaz: "Chaz's Used Auto Parts & Towing",
  citymotors: "City Motors",
  awap: "Alabama Wholesale Auto Parts",
  clearsalvage: "Clear Salvage",
  aplus: "A Plus Auto",
  central: "Central Auto Liquidators",
  coutu: "Truck Country",
  kodak: "Kodak Auto",
  rohner: "Rohner's Auto Parts",
  pratt: "Pratt's Auto Salvage",
  cars4parts: "Cars 4 Parts",
  meeks: "Meeks Pic-N-Pull",
  brandywine: "Brandywine U-Pull-It",
  rmmdtp: "Rocky Mountain Medium Duty Truck Parts",
  calton: "Calton Auto Parts Recyclers",
  aero: "Aero Auto Parts",
  row52: "Row52 / Pick-n-Pull",
  autorecycler: "AutoRecycler.io",
};

export const AVAILABLE_SOURCES: readonly DataSource[] = INGESTION_SOURCES;

interface InventorySourcesFilterProps {
  idPrefix: string;
  sources: DataSource[];
  onSourcesChange: (sources: DataSource[]) => void;
}

export function InventorySourcesFilter({
  idPrefix,
  sources,
  onSourcesChange,
}: InventorySourcesFilterProps) {
  return (
    <FieldSet className="gap-3">
      <FieldLegend className="sr-only">Inventory sources</FieldLegend>
      <FieldGroup className="gap-1">
        {AVAILABLE_SOURCES.map((source) => {
          const isChecked = sources.length === 0 || sources.includes(source);
          const checkboxId = `${idPrefix}-${source}`;

          return (
            <Field
              key={source}
              orientation="horizontal"
              className="hover:bg-muted/60 min-h-9 gap-3 rounded-md px-2 py-2"
            >
              <Checkbox
                id={checkboxId}
                checked={isChecked}
                onCheckedChange={(checked) => {
                  if (checked) {
                    if (sources.length === 0) return;
                    const newSources = [...sources, source];
                    onSourcesChange(
                      newSources.length === AVAILABLE_SOURCES.length
                        ? []
                        : newSources,
                    );
                    return;
                  }

                  if (sources.length === 0) {
                    onSourcesChange(
                      AVAILABLE_SOURCES.filter(
                        (availableSource) => availableSource !== source,
                      ),
                    );
                    return;
                  }

                  const newSources = sources.filter(
                    (selectedSource) => selectedSource !== source,
                  );
                  if (newSources.length > 0) {
                    onSourcesChange(newSources);
                  }
                }}
              />
              <FieldLabel
                htmlFor={checkboxId}
                className="min-w-0 cursor-pointer"
              >
                <span className="truncate">{SOURCE_LABELS[source]}</span>
              </FieldLabel>
            </Field>
          );
        })}
      </FieldGroup>
    </FieldSet>
  );
}

interface YearRangeFilterProps {
  yearRange: [number, number];
  onYearRangeChange: (range: [number, number]) => void;
  minimumYear: number;
  maximumYear: number;
}

export function YearRangeFilter({
  yearRange,
  onYearRangeChange,
  minimumYear,
  maximumYear,
}: YearRangeFilterProps) {
  return (
    <div className="flex flex-col gap-5 px-2">
      <div className="grid grid-cols-2 gap-4 text-sm tabular-nums">
        <div>
          <span className="text-muted-foreground block text-xs">Earliest</span>
          <output className="mt-1 block font-medium">{yearRange[0]}</output>
        </div>
        <div className="text-right">
          <span className="text-muted-foreground block text-xs">Latest</span>
          <output className="mt-1 block font-medium">{yearRange[1]}</output>
        </div>
      </div>
      <Slider
        value={yearRange}
        onValueChange={(value) => {
          const min = value[0];
          const max = value[1];
          if (typeof min === "number" && typeof max === "number") {
            onYearRangeChange([min, max]);
          }
        }}
        min={minimumYear}
        max={maximumYear}
        step={1}
        aria-label="Vehicle year range"
        onPointerDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      />
    </div>
  );
}

export function AdvancedFiltersUpsell({
  layout = "stacked",
}: {
  layout?: "stacked" | "inline";
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-4 py-2",
        layout === "inline" &&
          "sm:flex-row sm:items-center sm:justify-between sm:gap-6",
      )}
    >
      <div className="flex max-w-sm flex-col gap-2">
        <h3 className="text-base font-semibold">Filter the full inventory</h3>
        <p className="text-muted-foreground text-sm leading-6">
          Lite adds filters for source, make, year, color, state, and individual
          salvage yards from ${PLANS.lite.monthlyPrice}/month.
        </p>
      </div>
      <Button asChild size="sm">
        <Link href="/pricing">Compare plans</Link>
      </Button>
    </div>
  );
}
