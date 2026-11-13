import { expect, test } from "bun:test";
import { CaltonRecord } from "./calton-record";

const aliases = [
  {
    make: "CHRYSLER",
    model: "TOWN & COUNTRY",
    menu: "TOWN_-and_COUNTRY",
    donor: "TOWN_and__COUNTRY",
    vin: "2C4RC1BG9GR157461",
    year: "2016",
    stock: "L03014",
  },
  {
    make: "LINCOLN",
    model: "LINCOLN & TOWN CAR",
    menu: "LINCOLN_-and_TOWN_CAR",
    donor: "LINCOLN_and__TOWN_CAR",
    vin: "2LNBL8CV5BX760561",
    year: "2011",
    stock: "I05222",
  },
] as const;

function nativeRecord(input: {
  make: string;
  model: string;
  menu: string;
  donor: string;
  vin: string;
  year: string;
  stock: string;
}): CaltonRecord {
  const path = `/parts/${input.make}/${input.menu}`,
    sourceUrl = "https://caltonautoparts.com" + path;
  const destination = `https://caltonautoparts.com/parts/${input.make}/${input.donor}/${encodeURIComponent(input.stock)}/${input.year}`;
  return {
    sourceUrl,
    context: {
      kind: "model",
      sourceUrl,
      make: {
        path: `/parts/${input.make}`,
        literal: `https://caltonautoparts.com/parts/${input.make}`,
        label: input.make,
        count: 1,
      },
      model: { path, literal: sourceUrl, label: input.model, count: 1 },
    },
    ordinal: 0,
    cardId: input.stock,
    years: [input.year],
    titles: [
      input.model.startsWith(input.make + " ")
        ? input.model
        : `${input.make} ${input.model}`,
    ],
    vins: [input.vin],
    fields: [{ label: "stock", value: input.stock }],
    destinations: [{ literal: destination, url: destination }],
    images: [],
  };
}

test.each([...aliases])(
  "retains the observed $make menu and donor slug spellings without rewriting either",
  (input) => {
    const record = nativeRecord(input);
    const assessed = CaltonRecord.assess(record, [input.make]);
    expect(assessed.status).toBe("required-pass");
    expect(assessed.candidate?.detailsUrl).toBe(
      record.destinations[0]?.literal ?? "",
    );
    expect(assessed.record.context.sourceUrl).toContain(input.menu);
    for (const changed of [
      { ...record, titles: [`${input.make} OTHER`] },
      {
        ...record,
        destinations: record.destinations.map(({ literal }) => ({
          literal: literal?.replace(input.donor, "UNOBSERVED") ?? null,
          url: null,
        })),
      },
      {
        ...record,
        destinations: record.destinations.map(({ literal }) => ({
          literal: literal?.replace(input.make, "FOREIGNMAKE") ?? null,
          url: null,
        })),
      },
    ])
      expect(CaltonRecord.assess(changed, [input.make]).status).toBe(
        "identity-conflict",
      );
  },
);

test("compares a percent-encoded native stock segment without changing the literal destination", () => {
  const record = nativeRecord({ ...aliases[0], stock: "NOF 00" });
  const assessed = CaltonRecord.assess(record, ["CHRYSLER"]);
  expect(assessed.status).toBe("required-pass");
  expect(assessed.candidate?.stockNumber).toBe("NOF 00");
  expect(assessed.candidate?.detailsUrl).toContain("NOF%2000");
});
