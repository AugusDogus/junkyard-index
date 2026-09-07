import { INGESTION_SOURCES } from "~/lib/ingestion-source";
export const FIELDS = [
  "text",
  "make",
  "year",
  "color",
  "state",
  "yard",
  "source",
] as const;
export type Field = (typeof FIELDS)[number];
export type Comparison = "is" | "not" | "<" | "<=" | ">" | ">=";
export type Condition = {
  kind: "condition";
  field: Field;
  comparison: Comparison;
  value: string;
};
export type Expression =
  | Condition
  | { kind: "group"; operator: "AND" | "OR"; children: Expression[] };
type Parsed =
  | { success: true; value: Expression }
  | { success: false; error: string };
const fail = (error: string): Parsed => ({ success: false, error });
const isField = (value: string): value is Field =>
  FIELDS.some((field) => field === value);
const quote = (value: string) =>
  /^[\p{L}\p{N}_*-]+$/u.test(value) &&
  !value.startsWith("-") &&
  !["AND", "OR", "NOT"].includes(value)
    ? value
    : JSON.stringify(value);

export function serializeExpression(node: Expression, root = true): string {
  if (node.kind === "group") {
    const text = node.children
      .map((child) => serializeExpression(child, false))
      .filter(Boolean)
      .join(` ${node.operator} `);
    return root || node.children.length < 2 ? text : `(${text})`;
  }
  const prefix = node.comparison === "not" ? "!" : "";
  const comparison =
    node.comparison === "is" || node.comparison === "not"
      ? ""
      : node.comparison;
  return `${prefix}${node.field === "text" ? "" : `${node.field}:`}${comparison}${quote(node.value)}`;
}

/** Explicit field-expression grammar. Legacy saved queries use their original parser. */
export function parseExpression(input: string): Parsed {
  if (input.length > 4096)
    return fail("Keep the expression under 4,096 characters.");
  const tokens: string[] = [];
  let token = "";
  let quoted = false;
  let escaped = false;
  for (const character of input) {
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      token += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      token += character;
      continue;
    }
    if (
      !quoted &&
      (/\s/.test(character) || character === "(" || character === ")")
    ) {
      if (token) tokens.push(token);
      token = "";
      if (character === "(" || character === ")") tokens.push(character);
    } else token += character;
  }
  if (quoted)
    return fail("Close the quoted value. Your expression is preserved.");
  if (token) tokens.push(token);
  if (tokens.length > 128) return fail("Use at most 128 expression tokens.");
  let depth = 0;
  let index = 0;
  const condition = (raw: string): Parsed => {
    const excluded = raw.startsWith("!") || raw.startsWith("-");
    let value = excluded ? raw.slice(1) : raw;
    let field: Field = "text";
    const fieldMatch = /^([a-zA-Z]+):/.exec(value);
    if (fieldMatch) {
      const name = fieldMatch[1] ?? "";
      if (!isField(name) || name === "text")
        return fail(
          `Unknown field “${name}”. Use make, year, color, state, yard, or source.`,
        );
      field = name;
      value = value.slice(fieldMatch[0].length);
    }
    let comparison: Comparison = excluded ? "not" : "is";
    if (field === "year") {
      const match = /^(<=|>=|<|>|=)?(\d{4})$/.exec(value);
      if (!match)
        return fail("Use a four-digit year, such as year:2000 or year:<2000.");
      const operator = match[1];
      if (excluded && operator && operator !== "=")
        return fail("Use one year comparison, such as year:>=2000.");
      if (
        operator === "<" ||
        operator === ">" ||
        operator === "<=" ||
        operator === ">="
      )
        comparison = operator;
      value = match[2] ?? "";
    } else if (value.startsWith('"')) {
      try {
        const decoded: unknown = JSON.parse(value);
        if (typeof decoded !== "string") return fail("Use text inside quotes.");
        value = decoded;
      } catch {
        return fail(
          "Check the quoted value. Escape an inner quote with a backslash.",
        );
      }
    } else if (value.includes('"'))
      return fail(
        'Put quotes around the entire value, such as yard:"U Pull-It Omaha".',
      );
    if (!value.trim())
      return fail("Add a value to each condition before saving.");
    if (
      field === "source" &&
      !INGESTION_SOURCES.some((source) => source === value)
    )
      return fail(
        "Choose a supported source: pyp, pullapart, upullitne, upullitdavie, gopullit, row52, or autorecycler.",
      );
    return {
      success: true,
      value: { kind: "condition", field, comparison, value },
    };
  };
  const atom = (): Parsed => {
    const next = tokens[index++];
    if (!next || next === "AND" || next === "OR" || next === ")")
      return fail("Put a condition on both sides of AND or OR.");
    if (next === "(") {
      if (++depth > 12) return fail("Use at most 12 nested groups.");
      const result = disjunction();
      depth--;
      if (!result.success) return result;
      if (tokens[index++] !== ")")
        return fail("Close the open parenthesis before saving.");
      return result;
    }
    if (next === "NOT")
      return fail(
        "Use ! before a word or field to exclude it, such as !diesel.",
      );
    return condition(next);
  };
  const conjunction = (): Parsed => {
    const first = atom();
    if (!first.success) return first;
    const children = [first.value];
    while (
      index < tokens.length &&
      tokens[index] !== "OR" &&
      tokens[index] !== ")"
    ) {
      if (tokens[index] === "AND") index++;
      const next = atom();
      if (!next.success) return next;
      children.push(next.value);
    }
    return {
      success: true,
      value:
        children.length === 1
          ? first.value
          : { kind: "group", operator: "AND", children },
    };
  };
  const disjunction = (): Parsed => {
    const first = conjunction();
    if (!first.success) return first;
    const children = [first.value];
    while (tokens[index] === "OR") {
      index++;
      const next = conjunction();
      if (!next.success) return next;
      children.push(next.value);
    }
    return {
      success: true,
      value:
        children.length === 1
          ? first.value
          : { kind: "group", operator: "OR", children },
    };
  };
  if (!tokens.length)
    return {
      success: true,
      value: { kind: "group", operator: "AND", children: [] },
    };
  const result = disjunction();
  return index < tokens.length && result.success
    ? fail("Remove the unmatched closing parenthesis.")
    : result;
}
