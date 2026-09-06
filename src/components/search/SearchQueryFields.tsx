"use client";

import { useId, useRef, useState } from "react";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  buildAdvancedSearchQuery,
  getAdvancedSearchQueryFields,
  type AdvancedSearchQueryFields,
} from "~/lib/advanced-search-query";
import type { SearchCriteria } from "~/lib/search-criteria";

const QUERY_FIELDS = [
  {
    key: "allWords",
    label: "All of these words",
    hint: "Every word must match.",
    placeholder: "volvo wagon",
  },
  {
    key: "exactPhrase",
    label: "This exact phrase",
    hint: "Match these words together, in order.",
    placeholder: "crew cab",
  },
  {
    key: "anyWords",
    label: "Any of these words",
    hint: "Separate alternatives with commas.",
    placeholder: "Ford, Chevrolet, Ram",
  },
  {
    key: "excludedWords",
    label: "None of these words",
    hint: "Leave out vehicles with these words.",
    placeholder: "diesel, damaged",
  },
] as const;

type QueryMode = "fields" | "syntax" | "vin";

export function SearchQueryFields({
  value,
  queryMode,
  onChange,
}: {
  value: string;
  queryMode: SearchCriteria["queryMode"];
  onChange: (query: string, mode: SearchCriteria["queryMode"]) => void;
}) {
  const id = useId();
  const [fields, setFields] = useState<AdvancedSearchQueryFields>(
    () =>
      getAdvancedSearchQueryFields(value) ?? {
        allWords: "",
        exactPhrase: "",
        anyWords: "",
        excludedWords: "",
      },
  );
  const [mode, setMode] = useState<QueryMode>(() =>
    queryMode === "vin"
      ? "vin"
      : getAdvancedSearchQueryFields(value)
        ? "fields"
        : "syntax",
  );
  const keywordDraft = useRef(mode === "vin" ? "" : value);
  const vinDraft = useRef(mode === "vin" ? value : "");
  const canUseFields =
    mode !== "syntax" || getAdvancedSearchQueryFields(value) !== null;

  const changeMode = (next: string) => {
    if (next !== "fields" && next !== "syntax" && next !== "vin") return;
    if (mode === "vin") vinDraft.current = value;
    else keywordDraft.current = value;
    const nextQuery = next === "vin" ? vinDraft.current : keywordDraft.current;
    const nextFields = getAdvancedSearchQueryFields(nextQuery);
    setMode(next === "fields" && !nextFields ? "syntax" : next);
    if (nextFields) setFields(nextFields);
    onChange(nextQuery, next === "vin" ? "vin" : "keywords");
  };

  return (
    <FieldGroup className="gap-5">
      <ToggleGroup
        type="single"
        variant="outline"
        value={mode}
        onValueChange={changeMode}
        aria-label="Search input mode"
        className="w-full"
      >
        <ToggleGroupItem
          value="fields"
          disabled={!canUseFields}
          className="flex-1"
        >
          Keywords
        </ToggleGroupItem>
        <ToggleGroupItem value="syntax" className="flex-1">
          Query syntax
        </ToggleGroupItem>
        <ToggleGroupItem value="vin" className="flex-1">
          VIN pattern
        </ToggleGroupItem>
      </ToggleGroup>
      {mode === "fields" &&
        QUERY_FIELDS.map(({ key, label, hint, placeholder }) => (
          <Field key={key}>
            <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
            <Input
              id={`${id}-${key}`}
              value={fields[key]}
              placeholder={placeholder}
              autoComplete="off"
              onChange={(event) => {
                const nextFields = { ...fields, [key]: event.target.value };
                setFields(nextFields);
                onChange(buildAdvancedSearchQuery(nextFields), "keywords");
              }}
            />
            <FieldDescription>{hint}</FieldDescription>
          </Field>
        ))}
      {mode === "syntax" && (
        <Field>
          <FieldLabel htmlFor={`${id}-syntax`}>Search query</FieldLabel>
          <Textarea
            id={`${id}-syntax`}
            value={value}
            onChange={(event) => onChange(event.target.value, "keywords")}
            placeholder={'(Ford OR Ram) "crew cab" !diesel'}
            className="min-h-32"
          />
          <FieldDescription>
            Use OR for alternatives, quotes for phrases, and ! to exclude words.
            {!canUseFields &&
              " This query needs syntax editing to preserve its groups and phrases."}
          </FieldDescription>
        </Field>
      )}
      {mode === "vin" && (
        <Field>
          <FieldLabel htmlFor={`${id}-vin`}>VIN pattern</FieldLabel>
          <Input
            id={`${id}-vin`}
            value={value}
            onChange={(event) => onChange(event.target.value, "vin")}
            placeholder="YV4C*85**********"
            autoComplete="off"
            spellCheck={false}
          />
          <FieldDescription>
            Enter all 17 positions. Use * for each unknown character.
          </FieldDescription>
        </Field>
      )}
    </FieldGroup>
  );
}
