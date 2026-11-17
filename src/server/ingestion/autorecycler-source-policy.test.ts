import { expect, test } from "bun:test";
import { Effect } from "effect";
import { AutorecyclerSourcePolicy } from "./autorecycler-source-policy";

const root = "1761169592468x394558876247902400";
const child = "1761169972809x397685278936687600";
const independent = "1726602417880x199387504054651780";
const lookup = (id: string) => `1348695171700984260__LOOKUP__${id}`;
const doc = (id: string, parent = id) => ({
  _id: id,
  _type: "custom.organization",
  found: true,
  _source: { parent_organization_custom_organization: lookup(parent) },
});

test("excludes verified direct-provider ownership, not matching names or partner membership", async () => {
  let calls = 0;
  const policy = AutorecyclerSourcePolicy.create(async () => {
    calls++;
    return {
      docs: [
        doc(root),
        doc(child, root),
        {
          ...doc(independent),
          _source: {
            ...doc(independent)._source,
            name_text: "Pull A Part - Pittsburgh",
            partner_orgs_list_custom_organization: [lookup(root)],
          },
        },
      ],
    };
  });
  const result = await Effect.runPromise(
    policy([lookup(root), lookup(child), lookup(independent)]),
  );
  expect([...result.values()]).toEqual([
    "direct-provider",
    "direct-provider",
    "independent",
  ]);
  expect((await Effect.runPromise(policy([child]))).get(child)).toBe(
    "direct-provider",
  );
  expect(calls).toBe(1);
});

test("excludes former customers that are now read directly, even if their feed revives", async () => {
  const pauls = "1761071937027x514174316460297860";
  const ryans = "1757515768480x772759259987457800";
  const policy = AutorecyclerSourcePolicy.create(async () => ({
    docs: [doc(pauls), doc(ryans), doc(independent)],
  }));
  const result = await Effect.runPromise(
    policy([lookup(pauls), lookup(ryans), lookup(independent)]),
  );
  expect([...result.values()]).toEqual([
    "direct-provider",
    "direct-provider",
    "independent",
  ]);
});

test("keeps an explicit missing organization unresolved instead of treating it as owned", async () => {
  const policy = AutorecyclerSourcePolicy.create(async () => ({
    docs: [{ _id: independent, found: false }],
  }));
  expect(
    (await Effect.runPromise(policy([lookup(independent)]))).get(
      lookup(independent),
    ),
  ).toBe("unresolved");
});

test.each([
  {},
  { docs: [] },
  { docs: [doc(root)] },
  { docs: [doc(child), doc(child)] },
  { docs: [doc(child)], error: "failed" },
  { docs: [{ ...doc(child), _type: "custom.inventory" }] },
  { docs: [{ _id: child, found: false, _type: "custom.inventory" }] },
  { docs: [{ ...doc(child), _source: { _id: independent } }] },
  {
    docs: [
      {
        ...doc(child),
        _source: { parent_organization_custom_organization: "invalid" },
      },
    ],
  },
])(
  "rejects incomplete or contradictory ownership responses: %j",
  async (response) => {
    await expect(
      Effect.runPromise(
        AutorecyclerSourcePolicy.create(async () => response)([lookup(child)]),
      ),
    ).rejects.toThrow("source ownership lookup failed");
  },
);

test("retries after malformed results without reusing partial classifications", async () => {
  let calls = 0;
  const policy = AutorecyclerSourcePolicy.create(async () =>
    ++calls === 1
      ? { docs: [doc(child)] }
      : { docs: [doc(child, root), doc(independent)] },
  );
  await expect(Effect.runPromise(policy([child, independent]))).rejects.toThrow(
    "Incomplete",
  );
  expect(
    (await Effect.runPromise(policy([child, independent]))).get(child),
  ).toBe("direct-provider");
  expect(calls).toBe(2);
});

test("excludes all twelve verified LKQ imports and their children", async () => {
  const ids = [
    "1729734766990x950099823086187300",
    "1729734766093x340198914988167880",
    "1729734766535x427413633759663500",
    "1729734765104x535405133894433660",
    "1729734768283x592117435094416500",
    "1729734764662x232536945531569570",
    "1729734764195x109900838604892300",
    "1729734763657x870281075279977200",
    "1729734765576x140464582636548050",
    "1729734763257x684941304085489500",
    "1729734767394x763899678894703500",
    "1729734767860x176607785988997630",
  ];
  const policy = AutorecyclerSourcePolicy.create(async () => ({
    docs: [...ids.map((id) => doc(id)), doc(child, ids[0])],
  }));
  const result = await Effect.runPromise(policy([...ids.map(lookup), child]));
  expect([...result.values()]).toEqual(
    Array.from({ length: 13 }, () => "direct-provider"),
  );
});
