import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteStatus } from "~/lib/site-status";
import { StatusChipLink } from "./StatusChip";

const statusPage = (site: string, provider: string) => ({
  data: { attributes: { aggregate_state: "degraded" } },
  included: [
    { id: "1", type: "status_page_section", attributes: { position: 0 } },
    { id: "2", type: "status_page_section", attributes: { position: 1 } },
    {
      id: "site",
      type: "status_page_resource",
      attributes: { status_page_section_id: 1, status: site },
    },
    {
      id: "provider",
      type: "status_page_resource",
      attributes: { status_page_section_id: 2, status: provider },
    },
  ],
});

function render(json: unknown) {
  return renderToStaticMarkup(
    <StatusChipLink
      statusPageUrl="https://status.test"
      status={SiteStatus.parse(json)}
    />,
  );
}

test("a late provider heartbeat does not mark the public footer", () => {
  const html = render(statusPage("operational", "downtime"));
  expect(html).toContain(">System status</a>");
  expect(html).not.toContain("Degraded");
});

test("an unknown status reads the same as an operational one", () => {
  const html = renderToStaticMarkup(
    <StatusChipLink statusPageUrl="https://status.test" status="unknown" />,
  );
  expect(html).toContain(">System status</a>");
  expect(html).not.toContain("aria-hidden");
});

test("a site problem is shown", () => {
  expect(render(statusPage("degraded", "operational"))).toContain(
    "Degraded performance",
  );
  expect(render(statusPage("downtime", "operational"))).toContain(
    "Service disruption",
  );
});
