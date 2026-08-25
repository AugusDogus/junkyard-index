"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useCheckoutConfirmation } from "~/hooks/use-checkout-confirmation";
import { usePlanAccess } from "~/hooks/use-plan-access";
import type { PlanAccessState } from "~/lib/plan-access";

export function useCheckoutPlanAccess(isLoggedIn: boolean): PlanAccessState {
  const searchParams = useSearchParams();
  const [refreshUntilPaid] = useState(
    () => searchParams.get("subscription") === "success",
  );
  const planAccess = usePlanAccess(isLoggedIn, { refreshUntilPaid });
  useCheckoutConfirmation(planAccess);
  return planAccess;
}
