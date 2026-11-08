import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's own size names, so it would read the
 * theme's size roles (src/styles/tokens.css) as colours and drop
 * `text-figure` from `text-figure text-title`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["md", "display", "display-s", "section", "title", "lead"],
      tracking: ["display"],
      shadow: ["card"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Given an array of string variants (e.g., ["VOLVO", "Volvo"]),
 * pick the best one for display: prefer non-all-uppercase variants.
 * Falls back to title case if all variants are uppercase.
 */
export function pickDisplayName(variants: string[]): string {
  const first = variants[0];
  if (!first) return "";
  const nonUppercase = variants.find((v) => v !== v.toUpperCase());
  if (nonUppercase) return nonUppercase;
  return toTitleCase(first);
}

/**
 * Build a map from normalized (lowercase) keys to display names.
 * Groups all variants by lowercase, then picks the best display name for each group.
 */
export function buildDisplayNameMap(values: string[]): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const value of values) {
    const key = value.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      if (!existing.includes(value)) existing.push(value);
    } else {
      groups.set(key, [value]);
    }
  }
  const result = new Map<string, string>();
  for (const [key, variants] of groups) {
    result.set(key, pickDisplayName(variants));
  }
  return result;
}

const COLOR_ALIASES: Record<string, string> = {
  blk: "black",
  blu: "blue",
  brn: "brown",
  brz: "bronze",
  burg: "burgundy",
  char: "charcoal",
  gld: "gold",
  grn: "green",
  gry: "gray",
  grey: "gray",
  mrn: "maroon",
  org: "orange",
  pur: "purple",
  sil: "silver",
  tan: "tan",
  wht: "white",
  yel: "yellow",
  "grey/silver": "silver",
};

function isValidColor(color: string): boolean {
  if (!color || color === "UNKNOWN" || color === "Other") return false;
  if (color.startsWith("FIELD - ") || color.startsWith("[")) return false;
  return true;
}

export function normalizeColor(color: string): string | null {
  if (!isValidColor(color)) return null;
  const lower = color.toLowerCase();
  return COLOR_ALIASES[lower] ?? lower;
}

export function buildColorDisplayMap(colors: string[]): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const color of colors) {
    const normalized = normalizeColor(color);
    if (!normalized) continue;
    const existing = groups.get(normalized);
    if (existing) {
      if (!existing.includes(color)) existing.push(color);
    } else {
      groups.set(normalized, [color]);
    }
  }
  const result = new Map<string, string>();
  for (const [key, variants] of groups) {
    result.set(key, pickDisplayName(variants));
  }
  return result;
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param lat1 Latitude of first point
 * @param lng1 Longitude of first point
 * @param lat2 Latitude of second point
 * @param lng2 Longitude of second point
 * @returns Distance in miles
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
