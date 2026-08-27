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
        optionalWords: string[];
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

function adjacentTerm(
  tokens: SearchToken[],
  start: number,
  direction: -1 | 1,
): number | null {
  let index = start + direction;
  while (index >= 0 && index < tokens.length) {
    const token = tokens[index];
    if (!token) return null;
    if (token.kind === "term") return index;
    if (token.kind === "or") return null;
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

  const optionalTermIndices = new Set<number>();
  for (let index = 0; index < tokenized.length; index += 1) {
    if (tokenized[index]?.kind !== "or") continue;
    const left = adjacentTerm(tokenized, index, -1);
    const right = adjacentTerm(tokenized, index, 1);
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
    optionalTermIndices.add(left);
    optionalTermIndices.add(right);
  }

  const terms = tokenized.filter(
    (token): token is SearchTerm => token.kind === "term",
  );
  const algoliaQuery = terms
    .map((term) => {
      const value = term.quoted ? `"${term.value}"` : term.value;
      return term.excluded ? `-${value}` : value;
    })
    .join(" ");
  const optionalWords = tokenized.flatMap((token, index) =>
    token.kind === "term" && optionalTermIndices.has(index)
      ? [token.value]
      : [],
  );

  return {
    success: true,
    data: { algoliaQuery, optionalWords },
  };
}
