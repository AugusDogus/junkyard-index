import { describe, expect, test } from "bun:test";
import { YardMapUrl } from "./yard-map-url";

describe("yard map URL state", () => {
  test("round-trips a view and a selected yard", () => {
    const search = YardMapUrl.withYard(
      YardMapUrl.withView("", { center: [33.4484, -112.074], zoom: 9.25 }),
      "pyp:1234",
    );
    expect(search).toBe("?at=33.4484%2C-112.074%2C9.25&yard=pyp%3A1234");
    expect(YardMapUrl.view(search)).toEqual({
      center: [33.4484, -112.074],
      zoom: 9.25,
    });
    expect(YardMapUrl.yard(search)).toBe("pyp:1234");
  });

  test("keeps unrelated parameters and removes cleared state", () => {
    const search = "?utm_source=mail&at=1%2C2%2C3&yard=a%3Ab";
    expect(YardMapUrl.withView(search, null)).toBe(
      "?utm_source=mail&yard=a%3Ab",
    );
    expect(YardMapUrl.withYard(YardMapUrl.withView(search, null), null)).toBe(
      "?utm_source=mail",
    );
    expect(YardMapUrl.withYard("?yard=a%3Ab", null)).toBe("");
  });

  test("rounds coordinates to about a meter and zoom to hundredths", () => {
    expect(
      YardMapUrl.withView("", {
        center: [33.448412345, -112.07412345],
        zoom: 9.123456,
      }),
    ).toBe("?at=33.44841%2C-112.07412%2C9.12");
  });

  test.each([
    "?at=",
    "?at=1,2",
    "?at=1,2,3,4",
    "?at=abc,2,3",
    "?at=91,0,3",
    "?at=0,181,3",
    "?at=0,0,0.5",
    "?at=0,0,19",
    "?at=Infinity,0,3",
  ])("ignores an invalid view %s", (search) => {
    expect(YardMapUrl.view(search)).toBeNull();
  });

  test("ignores a missing or empty yard", () => {
    expect(YardMapUrl.yard("")).toBeNull();
    expect(YardMapUrl.yard("?yard=")).toBeNull();
  });
});
