const VIN_LENGTH = 17;
const VIN_CHARACTERS = "0123456789ABCDEFGHJKLMNPRSTUVWXYZ";

export type VinPatternError =
  | { type: "invalid_character"; character: string }
  | { type: "invalid_range"; range: string }
  | { type: "unclosed_set" }
  | { type: "empty_set" }
  | { type: "wrong_length"; positions: number };

export type ParsedVinPattern = {
  normalized: string;
  positions: string[][];
};

export type VinPatternParseResult =
  | { success: true; data: ParsedVinPattern }
  | { success: false; error: VinPatternError };

function isVinCharacter(value: string): boolean {
  return value.length === 1 && VIN_CHARACTERS.includes(value);
}

function expandRange(start: string, end: string): string[] | null {
  const isNumericRange = /\d/.test(start) && /\d/.test(end);
  const isAlphaRange = /[A-Z]/.test(start) && /[A-Z]/.test(end);
  if (!isNumericRange && !isAlphaRange) return null;

  const startIndex = VIN_CHARACTERS.indexOf(start);
  const endIndex = VIN_CHARACTERS.indexOf(end);
  if (startIndex < 0 || endIndex < startIndex) return null;

  const expanded = [...VIN_CHARACTERS.slice(startIndex, endIndex + 1)];
  return expanded.filter((character) =>
    isNumericRange ? /\d/.test(character) : /[A-Z]/.test(character),
  );
}

function parseSet(content: string): VinPatternParseResult | string[] {
  if (content.length === 0) {
    return { success: false, error: { type: "empty_set" } };
  }

  const characters = new Set<string>();
  let index = 0;
  while (index < content.length) {
    const start = content[index];
    if (!start || !isVinCharacter(start)) {
      return {
        success: false,
        error: { type: "invalid_character", character: start ?? "" },
      };
    }

    if (content[index + 1] === "-") {
      const end = content[index + 2];
      if (!end) {
        return {
          success: false,
          error: { type: "invalid_range", range: content.slice(index) },
        };
      }
      const expanded = expandRange(start, end);
      if (!expanded) {
        return {
          success: false,
          error: { type: "invalid_range", range: `${start}-${end}` },
        };
      }
      for (const character of expanded) characters.add(character);
      index += 3;
      continue;
    }

    characters.add(start);
    index += 1;
  }

  return [...characters];
}

function parse(input: string): VinPatternParseResult {
  const normalized = normalize(input);
  const positions: string[][] = [];
  let index = 0;

  while (index < normalized.length) {
    const character = normalized[index];
    if (!character) break;

    if (character === "*") {
      positions.push([]);
      index += 1;
      continue;
    }

    if (character === "[") {
      const closingIndex = normalized.indexOf("]", index + 1);
      if (closingIndex < 0) {
        return { success: false, error: { type: "unclosed_set" } };
      }
      const parsedSet = parseSet(normalized.slice(index + 1, closingIndex));
      if (!Array.isArray(parsedSet)) return parsedSet;
      positions.push(parsedSet);
      index = closingIndex + 1;
      continue;
    }

    if (!isVinCharacter(character)) {
      return {
        success: false,
        error: { type: "invalid_character", character },
      };
    }

    positions.push([character]);
    index += 1;
  }

  if (positions.length !== VIN_LENGTH) {
    return {
      success: false,
      error: { type: "wrong_length", positions: positions.length },
    };
  }

  return { success: true, data: { normalized, positions } };
}

function normalize(input: string): string {
  return input.trim().toUpperCase();
}

function isSearchCandidate(input: string): boolean {
  const normalized = normalize(input);
  return (
    normalized.includes("[") ||
    normalized.includes("]") ||
    normalized.includes("*") ||
    (normalized.length === VIN_LENGTH && !/\s/.test(normalized))
  );
}

function errorMessage(error: VinPatternError): string {
  switch (error.type) {
    case "invalid_character":
      return error.character
        ? `“${error.character}” is not valid in a VIN pattern.`
        : "The VIN pattern contains an invalid character.";
    case "invalid_range":
      return `“${error.range}” is not a valid ascending letter or number range.`;
    case "unclosed_set":
      return "Close the character set with ].";
    case "empty_set":
      return "Character sets cannot be empty.";
    case "wrong_length":
      return `Pattern describes ${error.positions} of ${VIN_LENGTH} VIN positions.`;
  }
}

function toAlgoliaFilter(pattern: ParsedVinPattern): string | undefined {
  const clauses = pattern.positions.flatMap((characters, position) => {
    if (characters.length === 0) return [];
    const choices = characters.map(
      (character) => `vinPositionTokens:"${position}:${character}"`,
    );
    return choices.length === 1 ? choices : [`(${choices.join(" OR ")})`];
  });
  return clauses.length > 0 ? clauses.join(" AND ") : undefined;
}

function toIndexTokens(vin: string): string[] {
  return [...normalize(vin)].map(
    (character, position) => `${position}:${character}`,
  );
}

export const VinPattern = {
  length: VIN_LENGTH,
  maxInputLength: VIN_LENGTH * 5,
  normalize,
  isSearchCandidate,
  parse,
  errorMessage,
  toAlgoliaFilter,
  toIndexTokens,
} as const;
