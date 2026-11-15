/** ISO 3779 check digit, scoped to Hollander Stores admission only. */
export function hollanderstoresVin(raw: string): string | null {
  const vin = raw.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return null;
  const values: Record<string, number> = {
    A: 1,
    B: 2,
    C: 3,
    D: 4,
    E: 5,
    F: 6,
    G: 7,
    H: 8,
    J: 1,
    K: 2,
    L: 3,
    M: 4,
    N: 5,
    P: 7,
    R: 9,
    S: 2,
    T: 3,
    U: 4,
    V: 5,
    W: 6,
    X: 7,
    Y: 8,
    Z: 9,
  };
  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = [...vin].reduce(
    (sum, character, index) =>
      sum + (values[character] ?? Number(character)) * (weights[index] ?? 0),
    0,
  );
  const remainder = sum % 11;
  return vin[8] === (remainder === 10 ? "X" : String(remainder)) ? vin : null;
}
