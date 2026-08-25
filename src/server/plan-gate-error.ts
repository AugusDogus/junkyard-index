import { TRPCError } from "@trpc/server";
import type { PlanFeature } from "~/lib/plans";

/** A typed plan-feature rejection that the tRPC formatter can serialize. */
export class PlanGateError extends TRPCError {
  constructor(
    readonly feature: PlanFeature,
    message: string,
  ) {
    super({ code: "FORBIDDEN", message });
    this.name = "PlanGateError";
  }
}
