import { describe, expect, test } from "bun:test";
import {
  parseOrgGeoFromDetailsInitData,
  parseOrgGeoFromOrganizationDoc,
  parseOrgGeoFromWebsiteRecord,
} from "./autorecycler-geo";

describe("autorecycler geo", () => {
  test("parseOrgGeoFromOrganizationDoc reads authoritative organization location data", () => {
    const org = "1348695171700984260__LOOKUP__test";
    const g = parseOrgGeoFromOrganizationDoc(
      {
        _id: org,
        _type: "custom.organization",
        _source: {
          name_text: "Foss Winston-Salem",
          address_city_text: "WINSTON-SALEM",
          address1_geographic_address: {
            lat: 36.0552047,
            lng: -80.2069893,
            address: "3459 Thomasville Rd, Winston-Salem, NC 27107, USA",
            components: {
              city: "Winston-Salem",
              state: "North Carolina",
              "state code": "NC",
            },
          },
        },
      },
      org,
    );
    expect(g).not.toBeNull();
    expect(g!.locationName).toBe("Foss Winston-Salem");
    expect(g!.locationCity).toBe("Winston-Salem");
    expect(g!.stateAbbr).toBe("NC");
  });

  test("parseOrgGeoFromWebsiteRecord reads authoritative website location data", () => {
    const org = "1348695171700984260__LOOKUP__test";
    const g = parseOrgGeoFromWebsiteRecord(
      {
        organization_custom_organization: org,
        name_text: "Kiker's U Pull It",
        address_geographic_address: {
          lat: 30.4440304,
          lng: -87.2515714,
          address: "3010 W Fairfield Dr, Pensacola, FL 32505, USA",
          components: {
            city: "Pensacola",
            state: "Florida",
            "state code": "FL",
          },
        },
      },
      org,
    );
    expect(g).not.toBeNull();
    expect(g!.locationName).toBe("Kiker's U Pull It");
    expect(g!.locationCity).toBe("Pensacola");
    expect(g!.stateAbbr).toBe("FL");
  });

  test("parseOrgGeoFromDetailsInitData reads gps_location_geographic_address", () => {
    const org = "1348695171700984260__LOOKUP__test";
    const rows = [
      {
        type: "custom.inventory",
        data: {
          _type: "custom.inventory",
          organization_custom_organization: org,
          gps_location_geographic_address: {
            lat: 36.77,
            lng: -76.45,
            address: "5411 W Military Hwy, Chesapeake, VA 23321, USA",
            components: {
              city: "Chesapeake",
              state: "Virginia",
              "state code": "VA",
            },
          },
          seo_description_text:
            "Looking for used parts in Chesapeake, VA? Look no further than Foss U-Pull-It Chesapeake VA! We are your go-to auto recycler.",
        },
      },
    ];
    const g = parseOrgGeoFromDetailsInitData(rows, org);
    expect(g).not.toBeNull();
    expect(g!.lat).toBe(36.77);
    expect(g!.lng).toBe(-76.45);
    expect(g!.stateAbbr).toBe("VA");
    expect(g!.locationName).toBe("Foss U-Pull-It Chesapeake VA");
    expect(g!.locationCity).toBe("Chesapeake");
    expect(g!.address).toContain("Chesapeake");
  });

  test("parseOrgGeoFromDetailsInitData falls back to city label when seo name is absent", () => {
    const org = "1348695171700984260__LOOKUP__test";
    const rows = [
      {
        type: "custom.inventory",
        data: {
          _type: "custom.inventory",
          organization_custom_organization: org,
          gps_location_geographic_address: {
            lat: 42.36,
            lng: -83.18,
            address: "9309 Hubbell Ave, Detroit, MI 48228, USA",
            components: {
              city: "Detroit",
              state: "Michigan",
              "state code": "MI",
            },
          },
        },
      },
    ];

    const g = parseOrgGeoFromDetailsInitData(rows, org);
    expect(g).not.toBeNull();
    expect(g!.locationName).toBe("AutoRecycler - Detroit");
    expect(g!.locationCity).toBe("Detroit");
  });

  test("parseOrgGeoFromDetailsInitData matches org after trim on both sides", () => {
    const orgCore = "1348695171700984260__LOOKUP__test";
    const rows = [
      {
        type: "custom.inventory",
        data: {
          organization_custom_organization: orgCore,
          gps_location_geographic_address: {
            lat: 1,
            lng: 2,
            components: { city: "X", "state code": "ST" },
          },
        },
      },
    ];
    const g = parseOrgGeoFromDetailsInitData(rows, `  ${orgCore}  `);
    expect(g).not.toBeNull();
    expect(g!.orgLookup).toBe(orgCore);
  });

  test("parseOrgGeoFromDetailsInitData returns null when org mismatches", () => {
    const rows = [
      {
        type: "custom.inventory",
        data: {
          organization_custom_organization: "other",
          gps_location_geographic_address: { lat: 1, lng: 2 },
        },
      },
    ];
    expect(parseOrgGeoFromDetailsInitData(rows, "expected")).toBeNull();
  });
});
