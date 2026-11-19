/** Engine descriptions are opaque unless they contain only a liter quantity. */
export const VehicleEngine = {
  normalize(value: string | null): string | null {
    const trimmed = value?.trim() ?? "";
    if (!trimmed) return null;
    const match = /^(\d+(?:\.\d+)?)\s*L$/i.exec(trimmed);
    const liters = match?.[1] ? Number(match[1]) : NaN;
    return Number.isFinite(liters) && liters > 0
      ? `${liters.toFixed(1)}L`
      : trimmed;
  },
} as const;
