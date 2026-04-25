export const MIN_VEHICLE_YEAR = 1886;

export function getMaxVehicleYear(): number {
  return new Date().getUTCFullYear() + 1;
}

export function clampVehicleYear(
  value: number | null | undefined,
  min = MIN_VEHICLE_YEAR,
  max = getMaxVehicleYear(),
): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function normalizeVehicleYearFilter(
  minYear: number | null | undefined,
  maxYear: number | null | undefined,
  min = MIN_VEHICLE_YEAR,
  max = getMaxVehicleYear(),
): {
  minYear: number | undefined;
  maxYear: number | undefined;
  range: [number, number];
  isFiltered: boolean;
} {
  let normalizedMinYear = clampVehicleYear(minYear, min, max);
  let normalizedMaxYear = clampVehicleYear(maxYear, min, max);

  if (
    normalizedMinYear !== undefined &&
    normalizedMaxYear !== undefined &&
    normalizedMinYear > normalizedMaxYear
  ) {
    [normalizedMinYear, normalizedMaxYear] = [
      normalizedMaxYear,
      normalizedMinYear,
    ];
  }

  const range: [number, number] = [
    normalizedMinYear ?? min,
    normalizedMaxYear ?? max,
  ];

  return {
    minYear: range[0] === min ? undefined : range[0],
    maxYear: range[1] === max ? undefined : range[1],
    range,
    isFiltered: range[0] !== min || range[1] !== max,
  };
}

export function mergeSelectedFilterOptions(
  availableOptions: string[],
  selectedOptions: string[],
): string[] {
  return [...new Set([...selectedOptions, ...availableOptions])]
    .filter((option) => option.trim().length > 0)
    .sort((left, right) => left.localeCompare(right));
}
