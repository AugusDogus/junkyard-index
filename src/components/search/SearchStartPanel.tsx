"use client";

import { ArrowRight, Search } from "lucide-react";
import { Button } from "~/components/ui/button";
import { SavedSearchesList } from "./SavedSearchesList";

interface SearchStartPanelProps {
  isLoggedIn: boolean;
  savedSearchesLocked: boolean;
  vinPatternSearchReady: boolean;
  onSearch: (query: string) => void;
}

const vehicleExamples = [
  {
    label: "Make + model",
    query: "Honda Civic",
    detail: "Browse every matching year",
  },
  {
    label: "Year + make + model",
    query: "2020 Toyota Tacoma",
    detail: "Narrow compatible donors",
  },
] as const;

export function SearchStartPanel({
  isLoggedIn,
  savedSearchesLocked,
  vinPatternSearchReady,
  onSearch,
}: SearchStartPanelProps) {
  const examples = [
    ...vehicleExamples,
    vinPatternSearchReady
      ? {
          label: "Partial VIN",
          query: "1HGCM826*3A******",
          detail: "Use * for unknown characters",
        }
      : {
          label: "Make + model",
          query: "Ford F-150",
          detail: "Search another common donor",
        },
  ];

  if (isLoggedIn) {
    return (
      <section className="py-8 sm:py-12" aria-label="Your searches">
        <SavedSearchesList locked={savedSearchesLocked} className="max-w-4xl" />
      </section>
    );
  }

  return (
    <section className="py-8 sm:py-12" aria-labelledby="search-start-title">
      <div className="max-w-2xl">
        <h2
          id="search-start-title"
          className="text-2xl font-semibold text-balance"
        >
          Search from broad to exact.
        </h2>
        <p className="text-muted-foreground mt-3 text-pretty">
          Start with a make and model to explore inventory. Add a year when
          compatibility is narrow, or use a VIN when the donor has to match.
        </p>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.65fr)] lg:gap-16">
        <div>
          <h3 className="text-sm font-medium">Try a search</h3>
          <div className="mt-2 flex flex-col gap-1">
            {examples.map((example) => (
              <Button
                key={example.query}
                type="button"
                variant="ghost"
                onClick={() => onSearch(example.query)}
                className="group h-auto w-full justify-start gap-3 px-3 py-3 text-left whitespace-normal"
              >
                <Search data-icon="inline-start" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{example.query}</span>
                  <span className="text-muted-foreground mt-0.5 block text-xs font-normal">
                    {example.label} · {example.detail}
                  </span>
                </span>
                <ArrowRight
                  data-icon="inline-end"
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </Button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium">
            Use the least detail that works
          </h3>
          <dl className="mt-5 flex flex-col gap-5 text-sm">
            <div>
              <dt className="font-medium">Explore inventory</dt>
              <dd className="text-muted-foreground mt-1">
                Search a make and model to compare every available year.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Narrow compatibility</dt>
              <dd className="text-muted-foreground mt-1">
                Add the model year before applying yard, location, and color
                filters.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Match a donor</dt>
              <dd className="text-muted-foreground mt-1">
                Paste a full VIN, or replace unknown VIN characters with *.
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
