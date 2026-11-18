/** Roving pin order wraps, so every yard remains reachable with arrow keys. */
export function nextYardPin(
  index: number,
  count: number,
  key: string,
): number | null {
  if (count === 0) return null;
  const step =
    key === "ArrowRight" || key === "ArrowDown"
      ? 1
      : key === "ArrowLeft" || key === "ArrowUp"
        ? -1
        : 0;
  return step === 0 ? null : (index + step + count) % count;
}
