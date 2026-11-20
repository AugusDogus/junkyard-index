import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PricingPlanCard } from "./PricingPlanCard";
import { AdvancedFiltersUpsell } from "../search/FilterFields";

test("pricing advertises free years, radius and the free first page accurately", () => {
  const free = renderToStaticMarkup(
    <PricingPlanCard
      tier="free"
      interval="monthly"
      featured={false}
      cta={null}
      heading="h2"
    />,
  );
  expect(free).toContain("Year range and distance radius filters");
  expect(free).toContain("The first 24 results of every search");
  expect(free).not.toContain("Full results");
  const lite = renderToStaticMarkup(
    <PricingPlanCard
      tier="lite"
      interval="monthly"
      featured={false}
      cta={null}
      heading="h2"
    />,
  );
  expect(lite).not.toContain("yard, year");
  expect(lite).toContain("Unlimited saved searches");
  expect(lite).toContain("Every result, not just the first 24");
  const full = renderToStaticMarkup(
    <PricingPlanCard
      tier="full"
      interval="monthly"
      featured={false}
      cta={null}
      heading="h2"
    />,
  );
  expect(full).toContain("New vehicle alerts by email");
});

test("filter upsell distinguishes free years and radius from Lite filters", () => {
  const html = renderToStaticMarkup(<AdvancedFiltersUpsell />);
  expect(html).toContain("Year range and distance radius are free");
  expect(html).not.toContain("make, year");
});
