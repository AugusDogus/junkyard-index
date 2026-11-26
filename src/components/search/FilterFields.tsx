import { YARD_TYPE_OPTIONS, type YardType } from "~/lib/yard-service";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
import { useHiddenSources } from "~/components/HiddenSourcesContext";
import { HiddenSources } from "~/lib/hidden-source";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";

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
  speedys: "Speedy's Transmission",
  sandw: "S&W Automotive Parts",
  denton: "Denton Auto Parts",
  beavers: "Beaver's Car Salvage",
  indianriver: "Indian River U-Pull-It",
  scotts: "Scott's Used Parts",
  oem: "OEM Auto Recyclers",
  dutchers: "Dutcher's Inc. Heavy Truck Division",
  alsauto: "Al's Auto Salvage",
  chasencars: "Chase N Cars",
  weberbrothers: "Weber Brothers Auto",
  hawaiiparts: "Hawaii Parts",
  modernmuscle: "Modern Muscle Salvage",
  carsandparts: "CarsAndPartsHub",
  spartan: "Spartan Auto",
  oemgarage: "oeM Garage",
  hagerman: "Hagerman",
  kandr: "K&R Truck Parts",
  jimsimport: "Jim's Import Auto Salvage",
  lonestarimports: "Lonestar Imports",
  alshned: "Alshned Auto Parts",
  hollanderstores: "Hollander Stores",
  cstruck: "C&S Truck Sales & Salvage",
  heavytruckparts: "HeavyTruckParts.net",
  allied: "Allied Auto Wrecking",
  urgiis: "Independent URG yards",
  harrys: "Harry's U-Pull It",
  budget: "Budget U Pull It",
  byot: "BYOT Auto Parts",
  vinplus: "VinPlus app yards",
  army: "Army's Auto Wrecking",
  idipull: "Idaho Falls I-Pull",
  bigd: "Big D Pick & Pull",
  pullsavewa: "Pull & Save Washington",
  littleton: "Littleton U-Pull-It",
  michigantruck: "Michigan Truck Parts",
  joliet: "Joliet U-Pull-It",
  alln1: "All-N-1 U Pull",
  grandpajohns: "Grandpa John’s Pick & Pull",
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
  northwest: "Northwest Auto Parts",
  coutu: "Truck Country",
  kodak: "Kodak Auto",
  six03: "603 Auto Salvage",
  rohner: "Rohner's Auto Parts",
  pratt: "Pratt's Auto Salvage",
  cars4parts: "Cars 4 Parts",
  meeks: "Meeks Pic-N-Pull",
  brandywine: "Brandywine U-Pull-It",
  rmmdtp: "Rocky Mountain Medium Duty Truck Parts",
  calton: "Calton Auto Parts Recyclers",
  aero: "Aero Auto Parts",
  vanderhaags: "Vander Haag’s",
  row52: "Row52 / Pick-n-Pull",
  autorecycler: "AutoRecycler.io",
};

/** The sources pickers offer: every one but hidden sources. */
export function availableSources(hidden: HiddenSources): DataSource[] {
  return HiddenSources.shown(hidden, INGESTION_SOURCES);
}

interface InventorySourcesFilterProps {
  idPrefix: string;
  sources: DataSource[];
  onSourcesChange: (sources: DataSource[]) => void;
}

export function InventorySourcesFilter({
  idPrefix,
  sources: selectedSources,
  onSourcesChange,
}: InventorySourcesFilterProps) {
  const hidden = useHiddenSources();
  const available = availableSources(hidden);
  const sources = HiddenSources.shown(hidden, selectedSources);
  return (
    <FieldSet className="gap-3">
      <FieldLegend className="sr-only">Inventory sources</FieldLegend>
      <FieldGroup className="gap-1">
        {available.map((source) => {
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
                      newSources.length === available.length ? [] : newSources,
                    );
                    return;
                  }

                  if (sources.length === 0) {
                    onSourcesChange(
                      available.filter(
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

/** How long arrow-key steps on the Year slider pause before they apply. */
const YEAR_KEYBOARD_APPLY_DELAY_MS = 500;

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
  // A drag passes through every year, and each applied range writes the URL.
  // Safari throws after 100 history writes in 10 seconds, so show the dragged
  // years here and apply only the released range. The drag stays shown until
  // the applied range moves off the one it started from, and then ends, so a
  // later Back or Clear to that range does not bring it back.
  const [drag, setDrag] = useState<{
    from: string;
    range: [number, number];
  } | null>(null);
  const appliedKey = yearRange.join(":");
  if (drag !== null && drag.from !== appliedKey) setDrag(null);
  const shownRange = drag?.from === appliedKey ? drag.range : yearRange;
  const toRange = (value: number[]): [number, number] | null => {
    const min = value[0];
    const max = value[1];
    return typeof min === "number" && typeof max === "number"
      ? [min, max]
      : null;
  };
  // The slider also commits each arrow-key step, and each applied range is
  // a search. Apply keyboard steps once they pause, or when focus leaves.
  // Pointer releases still apply at once.
  // A range applied meanwhile (such as by Back) wins over pending steps.
  const keyboardStep = useRef(false);
  const pendingKeyboardRange = useRef<{
    from: string;
    range: [number, number];
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const applied = useRef({ key: appliedKey, apply: onYearRangeChange });
  useEffect(() => {
    applied.current = { key: appliedKey, apply: onYearRangeChange };
  });
  const flushKeyboardRange = () => {
    const pending = pendingKeyboardRange.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingKeyboardRange.current = null;
    if (pending.from === applied.current.key)
      applied.current.apply(pending.range);
  };
  useEffect(() => flushKeyboardRange, []);
  return (
    <div className="flex flex-col gap-5 px-2">
      <div className="grid grid-cols-2 gap-4 text-sm tabular-nums">
        <div>
          <span className="text-muted-foreground block text-xs">Earliest</span>
          <output className="mt-1 block font-medium">{shownRange[0]}</output>
        </div>
        <div className="text-right">
          <span className="text-muted-foreground block text-xs">Latest</span>
          <output className="mt-1 block font-medium">{shownRange[1]}</output>
        </div>
      </div>
      <Slider
        value={shownRange}
        onValueChange={(value) => {
          const range = toRange(value);
          if (range) setDrag({ from: appliedKey, range });
        }}
        onValueCommit={(value) => {
          const range = toRange(value);
          if (!range) return;
          if (!keyboardStep.current) {
            flushKeyboardRange();
            onYearRangeChange(range);
            return;
          }
          const pending = pendingKeyboardRange.current;
          if (pending) clearTimeout(pending.timer);
          pendingKeyboardRange.current = {
            from: pending?.from ?? appliedKey,
            range,
            timer: setTimeout(flushKeyboardRange, YEAR_KEYBOARD_APPLY_DELAY_MS),
          };
        }}
        // Runs before the slider's own key handler commits the step.
        onKeyDown={() => {
          keyboardStep.current = true;
        }}
        onBlur={flushKeyboardRange}
        // A cancelled drag never commits, so drop the range it showed.
        onPointerCancel={() => setDrag(null)}
        min={minimumYear}
        max={maximumYear}
        step={1}
        aria-label="Vehicle year range"
        onPointerDown={(event) => {
          keyboardStep.current = false;
          event.stopPropagation();
        }}
        onTouchStart={(event) => event.stopPropagation()}
      />
    </div>
  );
}

export function AdvancedFiltersUpsell({
  layout = "stacked",
}: {
  /** `line` is one muted sentence, for the calm Filters panel and drawer. */
  layout?: "stacked" | "line";
}) {
  if (layout === "line")
    return (
      <p className="text-muted-foreground text-sm text-pretty">
        Make, state, color, yard and source filters come with Lite.{" "}
        <Link
          href="/pricing"
          className="text-foreground font-medium whitespace-nowrap underline underline-offset-2"
        >
          Compare plans
        </Link>
      </p>
    );
  return (
    <div className="flex flex-col items-start gap-4 py-2">
      <div className="flex max-w-sm flex-col gap-2">
        <h3 className="text-base font-medium">Filter the full inventory</h3>
        <p className="text-muted-foreground text-sm leading-6">
          Year range and distance radius are free. Lite adds filters for source,
          make, color, state, and individual salvage yards from $
          {PLANS.lite.monthlyPrice}/month.
        </p>
      </div>
      <Button asChild size="sm">
        <Link href="/pricing">Compare plans</Link>
      </Button>
    </div>
  );
}

export function YardTypeFilter({
  idPrefix,
  yardTypes,
  onYardTypesChange,
}: {
  idPrefix: string;
  yardTypes: YardType[];
  onYardTypesChange: (types: YardType[]) => void;
}) {
  return (
    <FieldSet className="gap-3">
      <FieldLegend className="sr-only">Yard type</FieldLegend>
      <FieldGroup className="gap-1">
        {YARD_TYPE_OPTIONS.map(({ value, label }) => (
          <Field
            key={value}
            orientation="horizontal"
            className="min-h-9 gap-3 px-2 py-2"
          >
            <Checkbox
              id={`${idPrefix}-${value}`}
              checked={yardTypes.includes(value)}
              onCheckedChange={(checked) =>
                onYardTypesChange(
                  checked === true
                    ? [...yardTypes, value]
                    : yardTypes.filter((type) => type !== value),
                )
              }
            />
            <FieldLabel htmlFor={`${idPrefix}-${value}`}>{label}</FieldLabel>
          </Field>
        ))}
      </FieldGroup>
      <p className="text-muted-foreground text-xs">
        Leave both unchecked to show all yards.
      </p>
    </FieldSet>
  );
}
