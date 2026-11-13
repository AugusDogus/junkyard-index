import { readFileSync } from "node:fs";
import type { Cars4PartsContract } from "./cars4parts-contract";
import { cars4partsAttribute } from "./cars4parts-html";
import {
  cars4partsHash,
  parseCars4PartsLeaf,
  type Cars4PartsPage,
} from "./cars4parts-parser";
import type { Cars4PartsRecord } from "./cars4parts-record";

export const cars4partsFixture = (name: string) =>
  readFileSync(
    new URL(`./cars4parts-test-fixtures/${name}.html`, import.meta.url),
    "utf8",
  );

export const cars4partsTestContract: Cars4PartsContract = {
  heyworth: {
    yard: {
      source: "cars4parts",
      code: "heyworth",
      name: "Test Heyworth Yard",
      operator: null,
      address: "1 Test Street",
      city: "Heyworth",
      state: "IL",
      postalCode: "61745",
      phone: null,
      email: null,
      lat: 40.312453,
      lng: -88.9935285,
      websiteUrl: "https://cars4parts.carzrus1.com/",
    },
    minimumUniqueInventory: 1,
  },
  armington: {
    yard: {
      source: "cars4parts",
      code: "armington",
      name: "Test Armington Yard",
      operator: null,
      address: "2 Test Street",
      city: "Armington",
      state: "IL",
      postalCode: "61721",
      phone: null,
      email: null,
      lat: 40.3376265,
      lng: -89.3186942,
      websiteUrl: "https://cars4parts.carzrus1.com/",
    },
    minimumUniqueInventory: 1,
  },
};
export function cars4partsTestRecord(name: string) {
  const raw = cars4partsFixture(name);
  const tag = [...raw.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((tag) => cars4partsAttribute(tag, "rel") === "canonical");
  const url = tag ? cars4partsAttribute(tag, "href") : null;
  if (!url)
    throw new Error(
      "Saved native fixture lacks its canonical detail destination",
    );
  const result = parseCars4PartsLeaf(raw, url);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
export function cars4partsTestPage(
  records: readonly Cars4PartsRecord[],
): Cars4PartsPage {
  const rows = records.map((record) => ({
    destination: record.destination,
    ymm: record.titles[0] ?? "",
    branch: record.branches[0] ?? "",
    roleLabel: null,
    narrative: "",
    stock: null,
    image: null,
  }));
  return {
    page: 1,
    pages: [1],
    rows,
    hash: cars4partsHash({ pages: [1], rows }),
  };
}
export function cars4partsTestResults(records: readonly Cars4PartsRecord[]) {
  return (
    '<div class="top-single-bar"></div><div class="hideOnSearch">' +
    records
      .map(
        (record) =>
          `<div class="result-car"><a class="result-car-link" href="${record.destination}"></a><p class="vehicle-name">${record.titles[0]}</p><p class="location-tag">${record.branches[0]}</p><p class="title-tag"></p><a href="${record.destination}">View Details</a></div>`,
      )
      .join("") +
    `<p class="paging"><a href='javascript:manual_hashchange("%23search%2Fpage-1/")'>1</a></p></div>`
  );
}
