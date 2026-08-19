import { timingSafeEqual } from "node:crypto";

export function hasValidCronAuthorization(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  if (!authorization || !secret) return false;

  const actual = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
