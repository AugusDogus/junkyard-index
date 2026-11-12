import { expect, test } from "bun:test";
import { parseAwapIdentity, parseAwapPage } from "./awap-parser";
import {
  awapSavedCensus,
  awapTestCard,
  awapTestPage,
} from "./awap-test-fixtures";
import { awapSnapshot } from "./awap-transform";
import { AWAP_CATALOG } from "./awap-yard-metadata";

test("AWAP saved eight-page census matches all183 independent native identities", () => {
  parseAwapIdentity(awapSavedCensus.about);
  let url: string | null = AWAP_CATALOG;
  const records = awapSavedCensus.pages.flatMap((raw, index) => {
    if (!url) throw new Error("Missing native next control");
    const page = parseAwapPage(raw, url);
    expect(page.page).toBe(index + 1);
    expect(page.total).toBe(183);
    url = page.next;
    return page.records;
  });
  expect(url).toBeNull();
  const snapshot = awapSnapshot(records);
  expect(snapshot.vehicles).toHaveLength(183);
  expect(snapshot.accounting.recordsRejected).toBe(0);
  expect(snapshot.observedVins).toEqual([]);
  for (const [index, expected] of awapSavedCensus.oracle.entries()) {
    const actual = snapshot.vehicles[index];
    expect(actual?.vin).toBe(expected.vin);
    expect(actual?.year).toBe(Number(expected.yearText));
    expect(actual?.make.toLowerCase()).toBe(expected.make.toLowerCase());
    expect(actual?.model).toBe(expected.model);
    expect(actual?.detailsUrl).toBe(expected.detailUrl);
    expect(actual?.stockNumber).toBeNull();
    expect(actual?.availableDate).toBeNull();
    expect(actual?.row).toBeNull();
    const nativeColor = expected.nativeColorLabels[0];
    expect(actual?.color).toBe(
      nativeColor === "N/A" || nativeColor === "NA"
        ? null
        : (nativeColor ?? null),
    );
    expect(actual?.imageUrl).toBe(expected.nativeImageUrl);
  }
});

test("AWAP malformed or ambiguous optional values stay null without gating donors", () => {
  const optional = `<div class="awap-cy-specs"><div><b>Color:</b> BLACK</div><div><b>Color:</b> WHITE</div><div><b>Engine:</b> ${"x".repeat(501)}</div><div><b>Trans:</b> Automatic</div></div><img src="https://www.alwholesaleautoparts.com/wp-content/uploads/${"x".repeat(2000)}.jpg">`;
  const card = awapTestCard(1, { optional }).replace(
    "sku=SKU1",
    "sku=SKU1&amp;sku=SKU2",
  );
  const page = parseAwapPage(awapTestPage(1, 1, [card]), AWAP_CATALOG);
  expect(page.records[0]).toMatchObject({
    skuClaim: null,
    color: null,
    engine: null,
    imageUrl: null,
    transmission: "Automatic",
  });
  expect(awapSnapshot(page.records).vehicles).toHaveLength(1);
  const malformed =
    '<div class="awap-cy-specs"><div><b>Color:</b> &unsupported;</div></div><img src="first.jpg" src="second.jpg">';
  const invalidPage = parseAwapPage(
    awapTestPage(1, 1, [awapTestCard(1, { optional: malformed })]),
    AWAP_CATALOG,
  );
  expect(invalidPage.records[0]).toMatchObject({ color: null, imageUrl: null });
  expect(awapSnapshot(invalidPage.records).vehicles).toHaveLength(1);
  for (const value of [
    "null",
    "none",
    "other",
    "not specified",
    "not available",
  ]) {
    const placeholders = `<div class="awap-cy-specs"><div><b>Color:</b> ${value}</div><div><b>Engine:</b> ${value}</div><div><b>Trans:</b> ${value}</div></div>`;
    expect(
      parseAwapPage(
        awapTestPage(1, 1, [awapTestCard(1, { optional: placeholders })]),
        AWAP_CATALOG,
      ).records[0],
    ).toMatchObject({ color: null, engine: null, transmission: null });
  }
});

test("AWAP pagination, source scope and control binding failures never become terminal evidence", () => {
  for (const body of [
    awapTestPage().replace(
      "currently being dismantled",
      "previously dismantled",
    ),
    awapTestPage().replace("Dismantling –", "Crushed –"),
    awapTestPage().replace('aria-current="page">1', 'aria-current="page">2'),
    awapTestPage().replace("Showing 1", "Showing 2"),
    awapTestPage().replace("</article>", ""),
    awapTestPage().replace("sku=SKU1", "sku=SKU1&amp;model=Civic"),
    awapTestPage().replace("/request-a-part/", "/foreign/"),
    awapTestPage().replace("</html>", ""),
    awapTestPage(
      1,
      26,
      Array.from({ length: 25 }, (_, i) => awapTestCard(i + 1)),
    ).replace("page/2/", "page/3/"),
  ])
    expect(() => parseAwapPage(body, AWAP_CATALOG)).toThrow();
  expect(() =>
    parseAwapIdentity(
      awapSavedCensus.about.replaceAll("205-538-2538", "205-000-0000"),
    ),
  ).toThrow("physical owner");
});

test("AWAP catalog-level assertion permits absent or consistently repeated per-card status", () => {
  const status = '<div class="awap-cy-dismantling">– Dismantling –</div>';
  for (const card of [
    awapTestCard(1).replace(status, ""),
    awapTestCard(1).replace(status, status + status),
  ]) {
    expect(
      awapSnapshot(
        parseAwapPage(awapTestPage(1, 1, [card]), AWAP_CATALOG).records,
      ).vehicles,
    ).toHaveLength(1);
  }
});
