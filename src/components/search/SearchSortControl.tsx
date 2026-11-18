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
};

export function SearchSortControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const option =
    SEARCH_SORT_OPTIONS.find((option) => option.key === value) ??
    SEARCH_SORT_OPTIONS[0];
  const label = option?.label ?? "Newest First";
  const compact = COMPACT_LABELS[value] ?? "Newest";
  const Icon =
    value === "distance"
      ? MapPin
      : value.startsWith("year-")
        ? ArrowUpDown
        : Calendar;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className="md:min-w-44"
        aria-label={`Sort vehicles: ${compact} (${label})`}
      >
        <Icon className="text-muted-foreground" aria-hidden="true" />
        <span className="md:hidden">{compact}</span>
        <span className="hidden md:inline">{label}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {SEARCH_SORT_OPTIONS.map(({ key, label }) => (
            <SelectItem key={key} value={key}>
              {label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
