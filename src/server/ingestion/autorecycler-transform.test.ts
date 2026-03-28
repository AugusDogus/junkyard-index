import { describe, expect, test } from "bun:test";
import {
  parseAutorecyclerNameText,
  transformAutorecyclerMsearchHit,
} from "./autorecycler-transform";

describe("autorecycler transform", () => {
  test("parseAutorecyclerNameText parses leading year in name_text", () => {
    expect(
      parseAutorecyclerNameText("2000 Nissan Sentra", undefined),
    ).toEqual({
      year: 2000,
      make: "Nissan",
      model: "Sentra",
    });
  });

  test("parseAutorecyclerNameText falls back to vehicle_year_number", () => {
    expect(parseAutorecyclerNameText("Nissan Sentra", 2001)).toEqual({
      year: 2001,
      make: "Nissan",
      model: "Sentra",
    });
  });

  test("parseAutorecyclerNameText keeps multi-word makes together", () => {
    expect(
      parseAutorecyclerNameText("2012 Land Rover Range Rover Sport", undefined),
    ).toEqual({
      year: 2012,
      make: "Land Rover",
      model: "Range Rover Sport",
    });
  });

  test("parseAutorecyclerNameText keeps hyphenated multi-word makes together", () => {
    expect(
      parseAutorecyclerNameText("1999 Mercedes-Benz C230", undefined),
    ).toEqual({
      year: 1999,
      make: "Mercedes-Benz",
      model: "C230",
    });
  });

  test("parseAutorecyclerNameText buckets numeric junk makes into Other", () => {
    expect(parseAutorecyclerNameText("2015 1963 Corvette", undefined)).toEqual({
      year: 2015,
      make: "Other",
      model: "Corvette",
    });
  });

  test("transformAutorecyclerMsearchHit builds canonical vehicle", () => {
    const geo = {
      orgLookup: "ORG1",
      lat: 36.1,
      lng: -80.2,
      locationName: "AutoRecycler - Winston-Salem",
      locationCity: "Winston-Salem",
      state: "North Carolina",
      stateAbbr: "NC",
    };
    const src = {
      vin_text: "3N1CB51D7YL308709",
      inventory_id_text: "1774437931255x929776907807752400",
      name_text: "2000 Nissan Sentra",
      vehicle_year_number: 2000,
      exterior_color_text: "GREY",
      stock_number_text: "STK1",
      organization_custom_organization: "ORG1",
      row_text: "300",
      added_date_date: 1_774_396_800_000,
      preview_image_image: "//cdn.example/img.jpg",
    };
    const v = transformAutorecyclerMsearchHit(src, geo);
    expect(v).not.toBeNull();
    expect(v!.vin).toBe("3N1CB51D7YL308709");
    expect(v!.source).toBe("autorecycler");
    expect(v!.imageUrl).toBe("https://cdn.example/img.jpg");
    expect(v!.detailsUrl).toContain("/details/1774437931255x929776907807752400");
    expect(v!.lat).toBe(36.1);
    expect(v!.lng).toBe(-80.2);
    expect(v!.locationName).toBe("AutoRecycler - Winston-Salem");
    expect(v!.locationCity).toBe("Winston-Salem");
    expect(v!.stateAbbr).toBe("NC");
    expect(v!.color).toBe("Gray");
  });
});
