"use client";

import { useId, useState, useContext } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Field, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { SEARCHABLE_VEHICLE_YEAR_RANGE } from "~/lib/saved-search-filters";
import type { SearchCriteria } from "~/lib/search-criteria";
import type { Draft } from "~/lib/saved-search-draft";
import { EditorPortal } from "./EditorPortal";
import { useFilterSuggestions } from "./FilterSuggestions";
import { SEARCH_SORT_OPTIONS } from "~/components/search/search-routing";
import { SuggestedValue } from "./SuggestedValue";

export function NameField({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
}) {
  const id = useId();
  return (
    <label className="se-field" htmlFor={id}>
      Search name
      <Input
        id={id}
        value={draft.name}
        maxLength={100}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
      />
    </label>
  );
}

const FILTERS = [
  "yearRange",
  "makes",
  "colors",
  "states",
  "salvageYards",
  "sources",
] as const;
type FilterKey = (typeof FILTERS)[number];
const LABELS: Record<FilterKey, string> = {
  yearRange: "Year",
  makes: "Make",
  colors: "Color",
  states: "State",
  salvageYards: "Salvage yard",
  sources: "Inventory sources",
};
const SOURCES = [
  ["pyp", "Pick Your Part"],
  ["pullapart", "Pull-A-Part"],
  ["upullitne", "U Pull-It (NE/IA)"],
  ["upullitdavie", "U Pull It Davie"],
  ["gopullit", "GO Pull-It"],
  ["row52", "Row52 / Pick-n-Pull"],
  ["autorecycler", "AutoRecycler.io"],
] as const;
function filterSummary(key: FilterKey, value: SearchCriteria) {
  return key === "yearRange"
    ? `${value.yearRange[0]}–${value.yearRange[1]}`
    : key === "sources"
      ? value.sources.length
        ? `${value.sources.length} selected`
        : "All sources"
      : value[key].join(", ") || "Any";
}

export function FilterEditor({
  value,
  onChange,
}: {
  value: SearchCriteria;
  onChange: (value: SearchCriteria) => void;
}) {
  const container = useContext(EditorPortal);
  const suggestions = useFilterSuggestions();
  const choices = {
    makes: suggestions.make,
    colors: suggestions.color,
    states: suggestions.state,
    salvageYards: suggestions.yard,
  };
  const [visible, setVisible] = useState<FilterKey[]>(() =>
    FILTERS.filter((key) =>
      key === "yearRange"
        ? value.yearRange[0] !== SEARCHABLE_VEHICLE_YEAR_RANGE.min ||
          value.yearRange[1] !== SEARCHABLE_VEHICLE_YEAR_RANGE.max
        : value[key].length > 0,
    ),
  );
  const [editing, setEditing] = useState<FilterKey | null>(null);
  const [adding, setAdding] = useState(false);
  const addValue = (
    key: "makes" | "colors" | "states" | "salvageYards",
    text: string,
  ) => {
    const clean = text.trim();
    if (
      clean &&
      !value[key].some((item) => item.toLowerCase() === clean.toLowerCase())
    )
      onChange({ ...value, [key]: [...value[key], clean] });
  };
  return (
    <div className="se-stack">
      {visible.map((key) => (
        <div key={key} className="se-filter">
          <div className="se-filter-heading">
            <button
              type="button"
              aria-expanded={editing === key}
              className="se-filter-summary"
              onClick={() => {
                setEditing(editing === key ? null : key);
              }}
            >
              <span>{LABELS[key]}</span>
              <span>{filterSummary(key, value)}</span>
              <ChevronDown size={14} />
            </button>
            <button
              type="button"
              className="se-icon"
              aria-label={`Remove ${LABELS[key]} filter`}
              onClick={() => {
                setVisible(visible.filter((item) => item !== key));
                onChange({
                  ...value,
                  [key]:
                    key === "yearRange"
                      ? [
                          SEARCHABLE_VEHICLE_YEAR_RANGE.min,
                          SEARCHABLE_VEHICLE_YEAR_RANGE.max,
                        ]
                      : [],
                });
              }}
            >
              <X size={14} />
            </button>
          </div>
          {editing === key && (
            <div className="se-filter-body">
              {key === "yearRange" ? (
                <div className="se-pair">
                  <label className="se-field">
                    From year
                    <Input
                      type="number"
                      min={1886}
                      max={SEARCHABLE_VEHICLE_YEAR_RANGE.max}
                      value={value.yearRange[0]}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          yearRange: [
                            Number(e.target.value),
                            value.yearRange[1],
                          ],
                        })
                      }
                    />
                  </label>
                  <label className="se-field">
                    Through year
                    <Input
                      type="number"
                      min={1886}
                      max={SEARCHABLE_VEHICLE_YEAR_RANGE.max}
                      value={value.yearRange[1]}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          yearRange: [
                            value.yearRange[0],
                            Number(e.target.value),
                          ],
                        })
                      }
                    />
                  </label>
                </div>
              ) : key === "sources" ? (
                <div className="se-choice-list">
                  {SOURCES.map(([source, label]) => (
                    <label key={source}>
                      <input
                        type="checkbox"
                        checked={
                          value.sources.length === 0 ||
                          value.sources.includes(source)
                        }
                        onChange={(e) => {
                          const selected = value.sources.length
                            ? value.sources
                            : SOURCES.map(([code]) => code);
                          const next = e.target.checked
                            ? [...selected, source]
                            : selected.filter((item) => item !== source);
                          if (next.length)
                            onChange({
                              ...value,
                              sources:
                                next.length === SOURCES.length ? [] : next,
                            });
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              ) : (
                <>
                  <div className="se-chips">
                    {value[key].map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="se-chip"
                        aria-label={`Remove ${item}`}
                        onClick={() =>
                          onChange({
                            ...value,
                            [key]: value[key].filter(
                              (choice) => choice !== item,
                            ),
                          })
                        }
                      >
                        {item}
                        <X size={12} />
                      </button>
                    ))}
                  </div>
                  <SuggestedValue
                    label={`Add ${LABELS[key]} value`}
                    suggestions={choices[key]}
                    selected={value[key]}
                    onSelect={(text) => addValue(key, text)}
                  />
                  <p className="se-hint">
                    Type a value to save it even if no vehicles match yet.
                  </p>
                </>
              )}
              <button
                type="button"
                className="se-text-button"
                onClick={() => setEditing(null)}
              >
                Done
              </button>
            </div>
          )}
        </div>
      ))}
      {visible.length < FILTERS.length && (
        <DropdownMenu open={adding} onOpenChange={setAdding} modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
            >
              <Plus size={14} />
              Add filter
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent container={container} align="start">
            {FILTERS.filter((key) => !visible.includes(key)).map((key) => (
              <DropdownMenuItem
                key={key}
                onSelect={() => {
                  setAdding(false);
                  setVisible([...visible, key]);
                  setEditing(key);
                }}
              >
                {LABELS[key]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function SortField({
  value,
  onChange,
}: {
  value: SearchCriteria;
  onChange: (value: SearchCriteria) => void;
}) {
  const id = useId();
  const container = useContext(EditorPortal);
  return (
    <Field orientation="horizontal">
      <FieldLabel htmlFor={id}>Sort results</FieldLabel>
      <Select
        value={value.sortBy}
        onValueChange={(sortBy) => onChange({ ...value, sortBy })}
      >
        <SelectTrigger id={id} className="min-w-35 sm:min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent container={container}>
          <SelectGroup>
            {SEARCH_SORT_OPTIONS.map(({ key, label }) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
