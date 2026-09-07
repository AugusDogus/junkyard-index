"use client";

import { useEffect, useState } from "react";
import { useFilterSuggestions } from "./FilterSuggestions";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import { SelectItem } from "~/components/ui/select";
import { EditorSelect } from "./EditorSelect";
import { Plus, X } from "lucide-react";
import { useBuilderEdits } from "./BuilderEdits";
import { Input } from "~/components/ui/input";
import { SuggestedValue } from "./SuggestedValue";
import {
  FIELDS,
  type Field,
  type Condition,
  type Expression,
  type Comparison,
} from "~/lib/search-expression";

const LABELS: Record<Field, string> = {
  text: "Word or phrase",
  make: "Make",
  year: "Year",
  color: "Color",
  state: "State",
  yard: "Salvage yard",
  source: "Inventory source",
};
const COMPARISONS: Record<Comparison, string> = {
  is: "is",
  not: "is not",
  "<": "before",
  "<=": "at or before",
  ">": "after",
  ">=": "at or after",
};
const EMPTY: Condition = {
  kind: "condition",
  field: "make",
  comparison: "is",
  value: "",
};

function ConditionForm({
  initial = EMPTY,
  onApply,
  onCancel,
}: {
  initial?: Condition;
  onApply: (value: Condition) => void;
  onCancel: () => void;
}) {
  const filterSuggestions = useFilterSuggestions();
  const [condition, setCondition] = useState(initial);
  const { setPending } = useBuilderEdits();
  useEffect(() => {
    setPending((count) => count + 1);
    return () => setPending((count) => count - 1);
  }, [setPending]);
  const suggestions =
    condition.field !== "text" && condition.field !== "year"
      ? filterSuggestions[condition.field]
      : null;
  const apply = (value: string) => {
    if (value.trim()) onApply({ ...condition, value: value.trim() });
  };
  return (
    <div className="se-condition-form">
      <div className="se-pair">
        <label className="se-field">
          Field
          <EditorSelect
            aria-label="Field"
            value={condition.field}
            onValueChange={(value) => {
              const field = FIELDS.find((item) => item === value);
              if (field) setCondition({ ...EMPTY, field });
            }}
          >
            {FIELDS.map((field) => (
              <SelectItem key={field} value={field}>
                {LABELS[field]}
              </SelectItem>
            ))}
          </EditorSelect>
        </label>
        <label className="se-field">
          Match
          <EditorSelect
            aria-label="Match"
            value={condition.comparison}
            onValueChange={(value) => {
              const comparison = Object.keys(COMPARISONS).find(
                (key): key is Comparison => key === value,
              );
              if (comparison) setCondition({ ...condition, comparison });
            }}
          >
            {Object.entries(COMPARISONS)
              .filter(
                ([key]) =>
                  condition.field === "year" || key === "is" || key === "not",
              )
              .map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
          </EditorSelect>
        </label>
      </div>
      {suggestions ? (
        <div className="se-field">
          <span>{LABELS[condition.field]}</span>
          <SuggestedValue
            key={condition.field}
            label={LABELS[condition.field]}
            suggestions={suggestions}
            value={condition.value}
            onValueChange={(value) => setCondition({ ...condition, value })}
            resetOnSelect={false}
            allowCustom={condition.field !== "source"}
            onSelect={(value) => setCondition({ ...condition, value })}
          />
        </div>
      ) : (
        <label className="se-field">
          {LABELS[condition.field]}
          <Input
            value={condition.value}
            type={condition.field === "year" ? "number" : "text"}
            placeholder={
              condition.field === "year"
                ? "2000"
                : "Enter a word or exact phrase"
            }
            onChange={(event) =>
              setCondition({ ...condition, value: event.target.value })
            }
          />
        </label>
      )}
      <p className="se-hint">
        Apply or cancel this condition before saving or switching modes.
      </p>
      <div className="se-builder-actions">
        <button
          type="button"
          className="se-small-button"
          disabled={
            !condition.value.trim() ||
            (condition.field === "year" && !/^\d{4}$/.test(condition.value)) ||
            (condition.field === "source" &&
              !INGESTION_SOURCES.some((source) => source === condition.value))
          }
          onClick={() => apply(condition.value)}
        >
          Apply condition
        </button>
        <button type="button" className="se-text-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ExpressionBuilder({
  expression,
  onChange,
  nested = false,
}: {
  expression: Expression;
  onChange: (value: Expression) => void;
  nested?: boolean;
}) {
  const { pending } = useBuilderEdits();
  const group =
    expression.kind === "group"
      ? expression
      : ({
          kind: "group",
          operator: "AND",
          children: [expression],
        } satisfies Expression);
  const [editing, setEditing] = useState<number | "new" | "group" | null>(null);
  const replace = (index: number, node: Expression) =>
    onChange({
      ...group,
      children: group.children.map((child, i) => (i === index ? node : child)),
    });
  return (
    <section
      className={`se-builder-group${nested ? " se-builder-nested" : ""}`}
      aria-label={nested ? "Condition group" : "Search builder"}
    >
      <label className="se-group-match">
        Match
        <EditorSelect
          aria-label={nested ? "Group matching" : "Search matching"}
          disabled={pending > 0}
          value={group.operator}
          onValueChange={(value) =>
            onChange({
              ...group,
              operator: value === "OR" ? "OR" : "AND",
            })
          }
        >
          <SelectItem value="AND">all</SelectItem>
          <SelectItem value="OR">any</SelectItem>
        </EditorSelect>
        of these conditions
      </label>
      <div className="se-builder-conditions">
        {group.children.map((node, index) => (
          <div className="se-builder-node" key={index}>
            {node.kind === "group" ? (
              <ExpressionBuilder
                expression={node}
                nested
                onChange={(value) => replace(index, value)}
              />
            ) : editing === index ? (
              <ConditionForm
                initial={node}
                onApply={(value) => {
                  replace(index, value);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <button
                type="button"
                className="se-condition-summary"
                disabled={pending > 0}
                aria-label={`Edit condition ${index + 1}: ${LABELS[node.field]} ${COMPARISONS[node.comparison]} ${node.value}`}
                onClick={() => setEditing(index)}
              >
                <span>
                  {LABELS[node.field]}{" "}
                  <small>{COMPARISONS[node.comparison]}</small>
                </span>
                <strong>{node.value}</strong>
              </button>
            )}
            <button
              type="button"
              className="se-icon"
              aria-label={`Remove condition ${index + 1}`}
              disabled={pending > 0}
              onClick={() => {
                onChange({
                  ...group,
                  children: group.children.filter((_, i) => i !== index),
                });
                setEditing(null);
              }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      {(editing === "new" || editing === "group") && (
        <ConditionForm
          onCancel={() => setEditing(null)}
          onApply={(value) => {
            onChange({
              ...group,
              children: [
                ...group.children,
                editing === "group"
                  ? { kind: "group", operator: "OR", children: [value] }
                  : value,
              ],
            });
            setEditing(null);
          }}
        />
      )}
      {editing === null && (
        <div className="se-builder-actions">
          <button
            type="button"
            className="se-text-button"
            disabled={pending > 0}
            onClick={() => setEditing("new")}
          >
            <Plus size={14} />
            Add condition
          </button>
          <button
            type="button"
            className="se-text-button"
            disabled={pending > 0}
            onClick={() => setEditing("group")}
          >
            <Plus size={14} />
            Add group
          </button>
        </div>
      )}
    </section>
  );
}
