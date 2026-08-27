const MAX_QUERY_BYTES = 512;

export interface AdvancedSearchQueryFields {
  allWords: string;
  exactPhrase: string;
  anyWords: string;
  excludedWords: string;
}

interface SearchTerm {
  kind: "term";
  value: string;
  quoted: boolean;
  excluded: boolean;
}

type SearchToken =
  | SearchTerm
  | { kind: "or" }
  | { kind: "and" }
  | { kind: "open" }
  | { kind: "close" };

export type AdvancedSearchQueryParseResult =
  | {
      success: true;
      data: {
        algoliaQuery: string;
        anyWordGroups: string[][];
      };
    }
  | {
      success: false;
      error: string;
    };

function normalizeWords(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function removeWrappingQuotes(value: string): string {
  return value
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/"/g, "");
}

function splitAlternatives(value: string): string[] {
  const normalized = normalizeWords(value);
  if (!normalized) return [];

  const parts = normalized.split(/[,\s]+/);
  return parts.map(removeWrappingQuotes).filter(Boolean);
}

function normalizeSearchToken(value: string): string {
  return normalizeWords(value).toLocaleLowerCase("en-US");
}

export function buildAdvancedSearchTokens(
  values: readonly (string | number | null | undefined)[],
): string[] {
  const tokens = new Set<string>();

  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = normalizeSearchToken(String(value));
    if (!normalized) continue;

    tokens.add(normalized);
    for (const word of normalized.split(/[^\p{L}\p{N}]+/u)) {
      if (word) tokens.add(word);
    }
  }

  return [...tokens];
}

function escapeAlgoliaFilterValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function buildAdvancedSearchFilters(
  anyWordGroups: readonly (readonly string[])[],
  existingFilters?: string,
): string | undefined {
  const groupFilters = anyWordGroups
    .filter((group) => group.length > 0)
    .map(
      (group) =>
        `(${group
          .map(
            (word) =>
              `searchTokens:"${escapeAlgoliaFilterValue(normalizeSearchToken(word))}"`,
          )
          .join(" OR ")})`,
    );

  if (groupFilters.length === 0) return existingFilters;
  if (existingFilters) groupFilters.unshift(`(${existingFilters})`);
  return groupFilters.join(" AND ");
}

export function buildAdvancedSearchQuery(
  fields: AdvancedSearchQueryFields,
): string {
  const parts: string[] = [];
  const allWords = normalizeWords(fields.allWords);
  const exactPhrase = normalizeWords(removeWrappingQuotes(fields.exactPhrase));
  const anyWords = splitAlternatives(fields.anyWords);
  const excludedWords = splitAlternatives(fields.excludedWords);

  if (allWords) parts.push(allWords);
  if (exactPhrase) parts.push(`"${exactPhrase}"`);
  if (anyWords.length > 0) parts.push(`(${anyWords.join(" OR ")})`);
  if (excludedWords.length > 0) {
    parts.push(excludedWords.map((word) => `!${word}`).join(" "));
  }

  return parts.join(" ");
}

export function hasAdvancedSearchSyntax(query: string): boolean {
  return /\b(?:AND|OR)\b|(^|\s)!\S|["()]/.test(query);
}

function readQuotedTerm(
  query: string,
  start: number,
): { value: string; nextIndex: number } | null {
  let value = "";
  let index = start + 1;
  while (index < query.length) {
    const character = query[index];
    if (character === "\\" && query[index + 1] === '"') {
      value += '"';
      index += 2;
      continue;
    }
    if (character === '"') {
      return { value: normalizeWords(value), nextIndex: index + 1 };
    }
    value += character;
    index += 1;
  }
  return null;
}

function tokenize(
  query: string,
): AdvancedSearchQueryParseResult | SearchToken[] {
  const tokens: SearchToken[] = [];
  let depth = 0;
  let index = 0;

  while (index < query.length) {
    const character = query[index];
    if (character === undefined) break;
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "(") {
      depth += 1;
      tokens.push({ kind: "open" });
      index += 1;
      continue;
    }
    if (character === ")") {
      if (depth === 0) {
        return {
          success: false,
          error: "Remove the unmatched closing parenthesis.",
        };
      }
      depth -= 1;
      tokens.push({ kind: "close" });
      index += 1;
      continue;
    }

    let excluded = false;
    if (character === "!" || character === "-") {
      excluded = true;
      index += 1;
      while (query[index] !== undefined && /\s/.test(query[index] ?? "")) {
        index += 1;
      }
    }

    if (query[index] === '"') {
      const quoted = readQuotedTerm(query, index);
      if (!quoted) {
        return {
          success: false,
          error: "Close the quoted phrase before searching.",
        };
      }
      if (!quoted.value) {
        return { success: false, error: "Remove the empty quoted phrase." };
      }
      tokens.push({
        kind: "term",
        value: quoted.value,
        quoted: true,
        excluded,
      });
      index = quoted.nextIndex;
      continue;
    }

    const start = index;
    while (
      index < query.length &&
      !/\s/.test(query[index] ?? "") &&
      query[index] !== "(" &&
      query[index] !== ")"
    ) {
      index += 1;
    }
    const value = query.slice(start, index);
    if (!value) {
      return {
        success: false,
        error: "Add a search term after the exclusion symbol.",
      };
    }
    if (!excluded && value === "OR") tokens.push({ kind: "or" });
    else if (!excluded && value === "AND") tokens.push({ kind: "and" });
    else tokens.push({ kind: "term", value, quoted: false, excluded });
  }

  if (depth > 0) {
    return {
      success: false,
      error: "Close the open parenthesis before searching.",
    };
  }
  return tokens;
}

function adjacentOrTerm(
  tokens: SearchToken[],
  start: number,
  direction: -1 | 1,
): number | null {
  let index = start + direction;
  while (index >= 0 && index < tokens.length) {
    const token = tokens[index];
    if (!token) return null;
    if (token.kind === "term") return index;
    if (token.kind !== "open" && token.kind !== "close") return null;
    index += direction;
  }
  return null;
}

export function parseAdvancedSearchQuery(
  query: string,
): AdvancedSearchQueryParseResult {
  if (new TextEncoder().encode(query).length > MAX_QUERY_BYTES) {
    return {
      success: false,
      error: `Keep the search query under ${MAX_QUERY_BYTES} bytes.`,
    };
  }

  const tokenized = tokenize(query);
  if (!Array.isArray(tokenized)) return tokenized;

  const orConnections = new Map<number, Set<number>>();
  for (let index = 0; index < tokenized.length; index += 1) {
    if (tokenized[index]?.kind !== "or") continue;
    const left = adjacentOrTerm(tokenized, index, -1);
    const right = adjacentOrTerm(tokenized, index, 1);
    if (left === null || right === null) {
      return {
        success: false,
        error: "Put a search term on both sides of OR.",
      };
    }
    if (tokenized[left]?.kind !== "term" || tokenized[right]?.kind !== "term") {
      return {
        success: false,
        error: "Put a search term on both sides of OR.",
      };
    }
    if (tokenized[left].excluded || tokenized[right].excluded) {
      return {
        success: false,
        error: "OR can only connect included search terms.",
      };
    }
    const leftConnections = orConnections.get(left) ?? new Set<number>();
    leftConnections.add(right);
    orConnections.set(left, leftConnections);
    const rightConnections = orConnections.get(right) ?? new Set<number>();
    rightConnections.add(left);
    orConnections.set(right, rightConnections);
  }

  const orTermIndices = new Set(orConnections.keys());
  const algoliaQuery = tokenized
    .flatMap((token, index) =>
      token.kind === "term" && !orTermIndices.has(index) ? [token] : [],
    )
    .map((term) => {
      const value = term.quoted ? `"${term.value}"` : term.value;
      return term.excluded ? `-${value}` : value;
    })
    .join(" ");

  const visited = new Set<number>();
  const anyWordGroups: string[][] = [];
  for (const start of orConnections.keys()) {
    if (visited.has(start)) continue;
    const pending = [start];
    const indices: number[] = [];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined || visited.has(current)) continue;
      visited.add(current);
      indices.push(current);
      for (const connected of orConnections.get(current) ?? []) {
        pending.push(connected);
      }
    }

    const group = indices
      .sort((left, right) => left - right)
      .flatMap((index) => {
        const token = tokenized[index];
        return token?.kind === "term"
          ? [normalizeSearchToken(token.value)]
          : [];
      });
    if (group.length > 0) anyWordGroups.push([...new Set(group)]);
  }

  return {
    success: true,
    data: { algoliaQuery, anyWordGroups },
  };
}
