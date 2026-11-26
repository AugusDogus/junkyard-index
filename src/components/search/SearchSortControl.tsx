"use client";

import { ArrowUpDown, Calendar, MapPin } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "~/components/ui/select";
import { SEARCH_SORT_OPTIONS } from "./search-routing";

const COMPACT_LABELS: Readonly<Record<string, string>> = {
  newest: "Newest",
  oldest: "Oldest",
  "year-desc": "Year ↓",
  "year-asc": "Year ↑",
  distance: "Nearest",
  relevance: "Relevance",
};

export function SearchSortControl({
  value,
  onChange,
  options = SEARCH_SORT_OPTIONS,
}: {
  value: string;
  onChange: (value: string) => void;
  options?: typeof SEARCH_SORT_OPTIONS;
}) {
  const option = options.find((option) => option.key === value) ?? options[0];
  const label = option?.label ?? "Newest First";
  const compact = COMPACT_LABELS[value] ?? "Newest";
  const Icon =
    value === "distance"
      ? MapPin
      : value === "newest" || value === "oldest"
        ? Calendar
        : ArrowUpDown;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        // The toolbar's outline treatment: no fill, the same border and weight.
        className="border-rule-strong text-ink hover:border-ink border bg-transparent font-medium shadow-none hover:bg-transparent md:min-w-44 dark:bg-transparent dark:hover:bg-transparent [&_svg]:text-current"
        aria-label={`Sort vehicles: ${compact} (${label})`}
      >
        {/* Phones drop the icon to keep the toolbar on one row. */}
        <Icon className="max-md:hidden" aria-hidden="true" />
        <span className="md:hidden">{compact}</span>
        <span className="hidden md:inline">{label}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map(({ key, label }) => (
            <SelectItem key={key} value={key}>
              {label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
