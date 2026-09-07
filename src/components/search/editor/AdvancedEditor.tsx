"use client";

import {
  useLayoutEffect,
  useState,
  type ChangeEvent,
  type RefObject,
} from "react";
import { compileSearchExpression } from "~/lib/compile-search-expression";
import { ExpressionBuilder } from "./ExpressionBuilder";
import { useBuilderEdits } from "./BuilderEdits";
import { InlineBuilder } from "./InlineBuilder";
import {
  parseExpression,
  serializeExpression,
  type Expression,
} from "~/lib/search-expression";

function ExpressionText({
  id,
  expression,
  inputRef,
  onChange,
}: {
  id: string;
  expression: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  const parsed = compileSearchExpression(expression);
  useLayoutEffect(() => {
    const element = inputRef.current;
    if (element) {
      element.style.height = "auto";
      element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
    }
  }, [expression, inputRef]);
  return (
    <div className="se-expression-editor">
      <label htmlFor={id}>Search expression</label>
      <textarea
        ref={inputRef}
        id={id}
        rows={3}
        className="se-input se-expression"
        value={expression}
        onChange={onChange}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={!parsed.success}
        aria-describedby={`${id}-help${!parsed.success ? ` ${id}-error` : ""}`}
        placeholder="(make:Volvo OR make:Saab) year:<2000 !diesel"
      />
      <p id={`${id}-help`} className="se-hint">
        Combine words and filters in one expression.
      </p>
      <details className="se-expression-help">
        <summary>Syntax help</summary>
        <p>
          <code>AND</code> requires both conditions. <code>OR</code> accepts
          either. Use <code>!diesel</code> to exclude a word and{" "}
          <code>"crew cab"</code> for an exact phrase.
        </p>
        <p>
          Fields: <code>make:Volvo</code>, <code>year:&lt;2000</code>,{" "}
          <code>color:Red</code>, <code>state:Texas</code>,{" "}
          <code>yard:"U Pull-It Omaha"</code>, <code>source:pyp</code>.
          Parentheses group alternatives. A space means AND. OR matches whole
          indexed words or values. Keep year comparisons in separate AND
          conditions.
        </p>
      </details>
      {!parsed.success && (
        <p id={`${id}-error`} role="status" className="se-error">
          {parsed.error}
        </p>
      )}
    </div>
  );
}

export function AdvancedEditor({
  id,
  expression,
  inputRef,
  onTextChange,
  onExpressionChange,
}: {
  id: string;
  expression: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onTextChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onExpressionChange: (text: string) => void;
}) {
  const { pending } = useBuilderEdits();
  const parsed = parseExpression(expression);
  const [tree, setTree] = useState<Expression | null>(() =>
    parsed.success ? parsed.value : null,
  );
  const [revision, setRevision] = useState(0);
  const text = (
    <ExpressionText
      id={id}
      expression={expression}
      inputRef={inputRef}
      onChange={(event) => {
        const result = parseExpression(event.currentTarget.value);
        setTree(result.success ? result.value : null);
        setRevision((value) => value + 1);
        onTextChange(event);
      }}
    />
  );
  const builder = tree ? (
    <ExpressionBuilder
      key={revision}
      expression={tree}
      onChange={(next) => {
        setTree(next);
        onExpressionChange(serializeExpression(next));
      }}
    />
  ) : (
    <p className="se-error">
      Fix the expression before using the builder. Your text is preserved.
    </p>
  );
  return (
    <InlineBuilder
      text={text}
      builder={builder}
      pending={pending > 0}
      valid={parsed.success}
    />
  );
}
