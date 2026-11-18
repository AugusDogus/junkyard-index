/** Bracketed repeated parameters distinguish literal commas from legacy lists. */
function write(
  params: URLSearchParams,
  key: string,
  values: readonly string[],
): void {
  for (const value of values) params.append(`${key}[]`, value);
}

function read(
  params: URLSearchParams,
  key: string,
  knownValues: readonly string[] = [],
): string[] {
  if (params.has(`${key}[]`)) return params.getAll(`${key}[]`).filter(Boolean);
  const candidates = [...knownValues].sort(
    (left, right) => right.length - left.length,
  );
  return params.getAll(key).flatMap((value) => {
    const values: string[] = [];
    let remaining = value;
    while (remaining) {
      // Prefer the longest known name, including any embedded commas. Unknown
      // legacy values retain the old comma-list interpretation, best effort.
      const known = candidates.find(
        (candidate) =>
          remaining === candidate || remaining.startsWith(`${candidate},`),
      );
      const end = known?.length ?? remaining.indexOf(",");
      if (end === -1) {
        values.push(remaining);
        break;
      }
      const item = remaining.slice(0, end);
      if (item) values.push(item);
      remaining = remaining.slice(end + 1);
    }
    return values;
  });
}

export const SearchFilterUrl = { read, write } as const;
