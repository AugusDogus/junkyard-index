import { expect, test } from "bun:test";
import { SiteStatus } from "./site-status";

const section = (id: string, position: number) => ({
  id,
  type: "status_page_section",
  attributes: { name: `Section ${id}`, position },
});
const resource = (sectionId: number, status: string) => ({
  id: `${sectionId}-${status}`,
  type: "status_page_resource",
  attributes: { status_page_section_id: sectionId, status },
});
const page = (aggregate: string, included: unknown[]) => ({
  data: { attributes: { aggregate_state: aggregate } },
  included,
});

test("reflects the site's own section, not provider heartbeats", () => {
  expect(
    SiteStatus.parse(
      page("degraded", [
        section("2", 1),
        section("1", 0),
        resource(1, "operational"),
        resource(2, "downtime"),
      ]),
    ),
  ).toBe("operational");
});

test("takes the worst status in the site's section", () => {
  expect(
    SiteStatus.parse(
      page("downtime", [
        section("1", 0),
        resource(1, "operational"),
        resource(1, "degraded"),
      ]),
    ),
  ).toBe("degraded");
  expect(
    SiteStatus.parse(
      page("downtime", [
        section("1", 0),
        resource(1, "degraded"),
        resource(1, "downtime"),
      ]),
    ),
  ).toBe("downtime");
});

test("reads only the top section, so its layout decides the badge", () => {
  // Providers moved above the site's monitors would mark the badge.
  expect(
    SiteStatus.parse(
      page("degraded", [
        section("1", 1),
        section("2", 0),
        resource(1, "operational"),
        resource(2, "degraded"),
      ]),
    ),
  ).toBe("degraded");
  // An emptied top section hides a site outage below it.
  expect(
    SiteStatus.parse(
      page("downtime", [
        section("1", 0),
        section("2", 1),
        resource(2, "downtime"),
      ]),
    ),
  ).toBe("unknown");
});

test("is unknown for unexpected shapes and unmonitored sections", () => {
  expect(SiteStatus.parse(null)).toBe("unknown");
  expect(SiteStatus.parse({ data: {} })).toBe("unknown");
  expect(SiteStatus.parse(page("operational", [section("1", 0)]))).toBe(
    "unknown",
  );
  expect(
    SiteStatus.parse(
      page("operational", [section("1", 0), resource(1, "maintenance")]),
    ),
  ).toBe("unknown");
});
