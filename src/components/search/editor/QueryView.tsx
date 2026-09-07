"use client";

import { useId, useLayoutEffect, useRef, type ChangeEvent } from "react";
import { hasAdvancedSearchSyntax } from "~/lib/advanced-search-query";
import { Input } from "~/components/ui/input";
import { useEditorMode } from "./EditorMode";
import { useBuilderEdits } from "./BuilderEdits";
import { FilterEditor } from "./controls";
import { AdvancedEditor } from "./AdvancedEditor";
import { parseExpression } from "~/lib/search-expression";
import {
  criteriaFromExpression,
  expressionFromCriteria,
} from "~/lib/search-expression-criteria";
import type { SearchCriteria } from "~/lib/search-criteria";
import type { Draft } from "~/lib/saved-search-draft";

/** Basic and VIN use facets; Advanced owns one complete expression. */
export function SearchTerms({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
}) {
  const id = useId();
  const { pending } = useBuilderEdits();
  const { mode, changeMode } = useEditorMode(draft.criteria.query);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const selectionToRestore = useRef<{ start: number; end: number } | null>(
    null,
  );
  const keywordDraft = useRef<Pick<Draft, "criteria" | "expression">>({
    criteria: {
      ...draft.criteria,
      queryMode: "keywords" as const,
      query: draft.criteria.queryMode === "vin" ? "" : draft.criteria.query,
    },
    expression: draft.expression,
  });
  const vinDraft = useRef<SearchCriteria | null>(
    draft.criteria.queryMode === "vin" ? draft.criteria : null,
  );
  const isVin = draft.criteria.queryMode === "vin";
  const advanced =
    !isVin &&
    (draft.expression !== null ||
      mode === "advanced" ||
      hasAdvancedSearchSyntax(draft.criteria.query));
  const expression = draft.expression ?? expressionFromCriteria(draft.criteria);
  const parsed = parseExpression(expression);
  const keywordExpression = isVin
    ? (keywordDraft.current.expression ??
      expressionFromCriteria(keywordDraft.current.criteria))
    : expression;
  const keywordParsed = parseExpression(keywordExpression);
  const basicCriteria = keywordParsed.success
    ? criteriaFromExpression(keywordParsed.value, draft.criteria)
    : null;
  const canUseBasic =
    basicCriteria !== null && !hasAdvancedSearchSyntax(basicCriteria.query);

  const updateExpression = (text: string) =>
    onChange({ ...draft, expression: text });
  const selectMode = (next: "basic" | "advanced" | "vin") => {
    if (next === "vin") {
      if (isVin) return;
      keywordDraft.current = {
        criteria: draft.criteria,
        expression: advanced ? expression : null,
      };
      const transferable = parsed.success
        ? criteriaFromExpression(parsed.value, draft.criteria)
        : null;
      const initial =
        transferable ??
        criteriaFromExpression(
          { kind: "group", operator: "AND", children: [] },
          draft.criteria,
        ) ??
        draft.criteria;
      const criteria =
        vinDraft.current ??
        ({ ...initial, queryMode: "vin", query: "" } satisfies SearchCriteria);
      onChange({
        ...draft,
        criteria: { ...criteria, sortBy: draft.criteria.sortBy },
        expression: null,
      });
    } else {
      if (isVin) vinDraft.current = { ...draft.criteria, queryMode: "vin" };
      changeMode(next);
      if (next === "basic" && basicCriteria)
        onChange({ ...draft, criteria: basicCriteria, expression: null });
      else
        onChange({
          ...draft,
          criteria: isVin
            ? {
                ...keywordDraft.current.criteria,
                sortBy: draft.criteria.sortBy,
              }
            : draft.criteria,
          expression: keywordExpression,
        });
    }
  };
  const changeQuery = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { value: query, selectionStart, selectionEnd } = event.currentTarget;
    if (advanced) {
      updateExpression(query);
    } else if (
      !isVin &&
      (hasAdvancedSearchSyntax(query) || /\b\w+:/.test(query))
    ) {
      selectionToRestore.current = {
        start: (selectionStart ?? query.length) + 1,
        end: (selectionEnd ?? query.length) + 1,
      };
      changeMode("advanced");
      // Keep the typed text at the start so the caret stays at its original position.
      const filters = expressionFromCriteria({ ...draft.criteria, query: "" });
      onChange({
        ...draft,
        expression: [`(${query})`, filters].filter(Boolean).join(" AND "),
      });
    } else onChange({ ...draft, criteria: { ...draft.criteria, query } });
  };
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
    if (selectionToRestore.current) {
      element.focus();
      element.setSelectionRange(
        selectionToRestore.current.start,
        selectionToRestore.current.end,
      );
      selectionToRestore.current = null;
    }
  }, [expression, advanced, isVin]);

  return (
    <section className="se-search-terms">
      <div className="se-search-mode" role="group" aria-label="Search mode">
        <button
          type="button"
          aria-pressed={!isVin && !advanced}
          disabled={pending > 0 || ((advanced || isVin) && !canUseBasic)}
          aria-describedby={
            !canUseBasic && advanced ? `${id}-mode-help` : undefined
          }
          onClick={() => selectMode("basic")}
        >
          Basic search
        </button>
        <button
          type="button"
          disabled={pending > 0}
          aria-pressed={advanced}
          onClick={() => selectMode("advanced")}
        >
          Advanced search
        </button>
        <button
          type="button"
          disabled={pending > 0}
          aria-pressed={isVin}
          onClick={() => selectMode("vin")}
        >
          VIN search
        </button>
      </div>
      {advanced ? (
        <AdvancedEditor
          id={id}
          expression={expression}
          inputRef={textarea}
          onTextChange={changeQuery}
          onExpressionChange={updateExpression}
        />
      ) : (
        <div className="se-expression-editor">
          <label htmlFor={id}>{isVin ? "VIN pattern" : "Search terms"}</label>
          <Input
            id={id}
            value={draft.criteria.query}
            onChange={changeQuery}
            spellCheck={!isVin}
            placeholder={
              isVin ? "YV4C*85**********" : "Make, model, or keywords"
            }
          />
        </div>
      )}
      {!canUseBasic && advanced && (
        <p id={`${id}-mode-help`} className="se-hint se-mode-help">
          This expression needs Advanced search.
        </p>
      )}
      {isVin && (
        <p className="se-hint">
          Use all 17 positions, with * for unknown characters. Your keyword or
          advanced search is kept when you switch back.
        </p>
      )}
      {!advanced && (
        <section className="se-basic-filters se-stack">
          <div>
            <h3>Filters</h3>
            <p className="se-hint">
              Choose a suggestion or add your own value.
            </p>
          </div>
          <FilterEditor
            key={isVin ? "vin" : "basic"}
            value={draft.criteria}
            onChange={(criteria) => onChange({ ...draft, criteria })}
          />
        </section>
      )}
    </section>
  );
}
