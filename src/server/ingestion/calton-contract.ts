import { createHash } from "node:crypto";
import { z } from "zod";
import { CALTON_ORIGIN, caltonOwnedUrl } from "./calton-html";
import type { CaltonControl } from "./calton-record";
import type { CanonicalVehicle } from "./types";

export const CaltonLocationSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    city: z.string().min(1),
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  })
  .strict();
export type CaltonLocation = z.infer<typeof CaltonLocationSchema>;
export type CaltonCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "calton";
};
export const CaltonContractSchema = z
  .object({
    location: CaltonLocationSchema,
    minimumUniqueInventory: z.number().int().positive().safe(),
  })
  .strict();
export type CaltonContract = z.infer<typeof CaltonContractSchema>;
export interface CaltonError {
  tag: "CaltonError";
  operation: string;
  message: string;
}
export type CaltonResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CaltonError };
export const CaltonError = {
  create(operation: string, detail: string): CaltonError {
    return {
      tag: "CaltonError",
      operation,
      message: `Calton ${operation}: ${detail}. Prior inventory is preserved; inspect the saved evidence and resume from the last validated checkpoint.`,
    };
  },
} as const;
export function caltonBoundary<T>(
  operation: string,
  run: () => T,
): CaltonResult<T> {
  try {
    return { ok: true, value: run() };
  } catch (cause) {
    return {
      ok: false,
      error: CaltonError.create(
        operation,
        cause instanceof Error ? cause.message : String(cause),
      ),
    };
  }
}
export const caltonHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const CALTON_ROOT = CALTON_ORIGIN + "/";
export const CALTON_MAKES = CALTON_ORIGIN + "/parts/";

/** Validate the published literal itself; never rebuild a foreign URL from its path. */
export function caltonControlUrl(
  control: CaltonControl,
  depth: 2 | 3,
): string | null {
  const url = caltonOwnedUrl(control.literal);
  return url &&
    url.pathname === control.path &&
    url.pathname.split("/").length === depth + 1 &&
    /^\/parts\/[^/]+(?:\/[^/]+)?$/.test(url.pathname)
    ? url.href
    : null;
}
export const CaltonContract = {
  schema: CaltonContractSchema,
  parse(input: unknown) {
    return caltonBoundary("qualification contract", () =>
      CaltonContractSchema.parse(input),
    );
  },
} as const;
