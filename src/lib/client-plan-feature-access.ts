import type { PlanAccessState } from "~/lib/plan-access";
import { hasPlanFeature, type PlanFeature } from "~/lib/plans";

// These actions are authorized again by their server mutations. Keeping their
// controls interactive avoids a hydration-time false upgrade prompt.
const INTERACTIONS_ALLOWED_WHILE_UNRESOLVED = new Set<PlanFeature>([
  "saved_searches",
  "alerts",
]);

export function resolveClientPlanFeatureAccess(input: {
  access: PlanAccessState;
  feature: PlanFeature;
}): boolean {
  if (input.access.kind === "resolved") {
    return hasPlanFeature(input.access.tier, input.feature);
  }
  return INTERACTIONS_ALLOWED_WHILE_UNRESOLVED.has(input.feature);
}
