"use client";

import {
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  useQueryState,
} from "nuqs";
import { useCallback, useMemo } from "react";
import type { DataSource, Vehicle } from "~/lib/types";
import { buildColorDisplayMap, buildDisplayNameMap, normalizeColor } from "~/lib/utils";

export interface FilterOptions {
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
}

export interface UseSearchFiltersReturn {
  // Filter state
  makes: string[];
  setMakes: (value: string[]) => void;
  colors: string[];
  setColors: (value: string[]) => void;
  states: string[];
  setStates: (value: string[]) => void;
  salvageYards: string[];
  setSalvageYards: (value: string[]) => void;
  sources: string[];
  typedSources: DataSource[];
  setSources: (value: string[]) => void;
  
  // Year range
  yearRange: [number, number];
  setMinYear: (value: number | null) => void;
  setMaxYear: (value: number | null) => void;
  dataMinYear: number;
  
  // Sort
  sortBy: string;
  setSortBy: (value: string) => void;
  
  // Computed values
  filteredVehicles: Vehicle[];
  activeFilterCount: number;
  filterOptions: FilterOptions;
  
  // Actions
  clearAllFilters: () => void;
}

export function useSearchFilters(
  vehicles: Vehicle[] | undefined,
  currentYear: number,
): UseSearchFiltersReturn {
  // Sort state - should be in URL for shareability
  const [sortBy, setSortByState] = useQueryState(
    "sort",
    parseAsString.withDefault("newest"),
  );

  // URL state for year range using built-in integer parser
  const [minYearParam, setMinYearParam] = useQueryState(
    "minYear",
    parseAsInteger,
  );
  const [maxYearParam, setMaxYearParam] = useQueryState(
    "maxYear",
    parseAsInteger,
  );

  // Individual filter states using nuqs built-in parsers
  const [makes, setMakesState] = useQueryState(
    "makes",
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const [colors, setColorsState] = useQueryState(
    "colors",
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const [states, setStatesState] = useQueryState(
    "states",
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const [salvageYards, setSalvageYardsState] = useQueryState(
    "yards",
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const [sources, setSourcesState] = useQueryState(
    "sources",
    parseAsArrayOf(parseAsString).withDefault([]),
  );

  // Type-safe sources conversion
  const typedSources = useMemo(
    () => sources.filter((s): s is DataSource => s === "pyp" || s === "row52"),
    [sources],
  );

  // Calculate minimum year from search results
  const dataMinYear = useMemo(() => {
    if (!vehicles || vehicles.length === 0) {
      return 1900; // Fallback only when no data
    }

    const years = vehicles.map((vehicle: Vehicle) => vehicle.year);
    return Math.min(...years);
  }, [vehicles]);

  // Year range from URL state (user interacts with this directly)
  const yearRange = useMemo(
    (): [number, number] => [
      minYearParam ?? dataMinYear,
      maxYearParam ?? currentYear,
    ],
    [minYearParam, maxYearParam, dataMinYear, currentYear],
  );

  // Custom year range setters that clear URL params when at defaults
  const setMinYear = useCallback(
    (value: number | null) => {
      if (value === dataMinYear) {
        void setMinYearParam(null);
      } else {
        void setMinYearParam(value);
      }
    },
    [dataMinYear, setMinYearParam],
  );

  const setMaxYear = useCallback(
    (value: number | null) => {
      if (value === currentYear) {
        void setMaxYearParam(null);
      } else {
        void setMaxYearParam(value);
      }
    },
    [currentYear, setMaxYearParam],
  );

  // Wrapper setters to match expected signatures
  const setMakes = useCallback(
    (value: string[]) => void setMakesState(value),
    [setMakesState],
  );
  const setColors = useCallback(
    (value: string[]) => void setColorsState(value),
    [setColorsState],
  );
  const setStates = useCallback(
    (value: string[]) => void setStatesState(value),
    [setStatesState],
  );
  const setSalvageYards = useCallback(
    (value: string[]) => void setSalvageYardsState(value),
    [setSalvageYardsState],
  );
  const setSources = useCallback(
    (value: string[]) => void setSourcesState(value),
    [setSourcesState],
  );
  const setSortBy = useCallback(
    (value: string) => void setSortByState(value),
    [setSortByState],
  );

  // Build display name maps for normalized filtering
  const displayNameMaps = useMemo(() => {
    if (!vehicles || vehicles.length === 0) {
      return {
        makes: new Map<string, string>(),
        colors: new Map<string, string>(),
      };
    }

    const allMakes = vehicles.map((v: Vehicle) => v.make);
    const allColors = vehicles.map((v: Vehicle) => v.color);

    return {
      makes: buildDisplayNameMap(allMakes),
      colors: buildColorDisplayMap(allColors),
    };
  }, [vehicles]);

  // Calculate filter options from search results
  const filterOptions = useMemo((): FilterOptions => {
    if (!vehicles || vehicles.length === 0) {
      return {
        makes: [],
        colors: [],
        states: [],
        salvageYards: [],
      };
    }

    // Use display names (sorted by display name)
    const makesOptions = Array.from(displayNameMaps.makes.values()).sort();
    const colorsOptions = Array.from(displayNameMaps.colors.values()).sort();

    const allStates = Array.from(
      new Set(vehicles.map((vehicle: Vehicle) => vehicle.location.state)),
    ).sort();
    const allSalvageYards = Array.from(
      new Set(vehicles.map((vehicle: Vehicle) => vehicle.location.name)),
    ).sort();

    return {
      makes: makesOptions,
      colors: colorsOptions,
      states: allStates,
      salvageYards: allSalvageYards,
    };
  }, [vehicles, displayNameMaps]);

  const clearAllFilters = useCallback(() => {
    void setMakesState([]);
    void setColorsState([]);
    void setStatesState([]);
    void setSalvageYardsState([]);
    void setSourcesState([]);

    // Clear URL parameters when user explicitly clears all filters
    void setMinYearParam(null);
    void setMaxYearParam(null);
    void setSortByState("newest"); // Reset sort to default
  }, [
    setMakesState,
    setColorsState,
    setStatesState,
    setSalvageYardsState,
    setSourcesState,
    setMinYearParam,
    setMaxYearParam,
    setSortByState,
  ]);

  // Calculate active filter count
  const activeFilterCount = useMemo(() => {
    const dataYearRange: [number, number] =
      vehicles && vehicles.length > 0
        ? [dataMinYear, currentYear]
        : [1900, currentYear];

    return (
      makes.length +
      colors.length +
      states.length +
      salvageYards.length +
      sources.length +
      (yearRange &&
      (yearRange[0] !== dataYearRange[0] || yearRange[1] !== dataYearRange[1])
        ? 1
        : 0)
    );
  }, [
    makes,
    colors,
    states,
    salvageYards,
    sources,
    yearRange,
    currentYear,
    vehicles,
    dataMinYear,
  ]);

  // Normalized filter sets for case-insensitive comparison
  const normalizedFilters = useMemo(
    () => ({
      makes: new Set(makes.map((m) => m.toLowerCase())),
      colors: new Set(colors.map((c) => c.toLowerCase())),
    }),
    [makes, colors],
  );

  // Comprehensive filtering logic - all client-side, no server filtering
  const filteredVehicles = useMemo(() => {
    if (!vehicles) return [];

    return vehicles.filter((vehicle: Vehicle) => {
      if (
        yearRange &&
        (vehicle.year < yearRange[0] || vehicle.year > yearRange[1])
      ) {
        return false;
      }
      if (
        normalizedFilters.makes.size > 0 &&
        !normalizedFilters.makes.has(vehicle.make.toLowerCase())
      ) {
        return false;
      }
      if (normalizedFilters.colors.size > 0) {
        const vehicleColor = normalizeColor(vehicle.color);
        if (!vehicleColor || !normalizedFilters.colors.has(vehicleColor)) {
          return false;
        }
      }
      if (states.length > 0 && !states.includes(vehicle.location.state)) {
        return false;
      }
      if (
        salvageYards.length > 0 &&
        !salvageYards.includes(vehicle.location.name)
      ) {
        return false;
      }
      return true;
    });
  }, [vehicles, normalizedFilters, states, salvageYards, yearRange]);

  return {
    // Filter state
    makes,
    setMakes,
    colors,
    setColors,
    states,
    setStates,
    salvageYards,
    setSalvageYards,
    sources,
    typedSources,
    setSources,

    // Year range
    yearRange,
    setMinYear,
    setMaxYear,
    dataMinYear,

    // Sort
    sortBy,
    setSortBy,

    // Computed values
    filteredVehicles,
    activeFilterCount,
    filterOptions,

    // Actions
    clearAllFilters,
  };
}
