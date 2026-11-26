import { describe, expect, test } from "bun:test";
import { HostClaims } from "./host-claims";

const urg = (lane: string): HostClaims => ({
  lanes: ["urg:" + lane],
  places: [{ group: "urg", capacity: 2 }],
});
const run = (runId: string, claims: HostClaims) => ({ runId, claims });

describe("HostClaims.admit", () => {
  test("admits one run per lane", () => {
    const admitted = HostClaims.admit(
      [run("aviation", urg("aws")), run("central", urg("aws"))],
      [],
    );
    expect(admitted.map((r) => r.runId)).toEqual(["aviation"]);
  });

  test("admits no more runs in a group than its places", () => {
    const admitted = HostClaims.admit(
      [run("a", urg("a")), run("b", urg("b")), run("c", urg("c"))],
      [],
    );
    expect(admitted.map((r) => r.runId)).toEqual(["a", "b"]);
  });

  test("counts runs already fetching against lanes and places", () => {
    const admitted = HostClaims.admit(
      [run("central", urg("aws")), run("pratt", urg("pratt"))],
      [urg("aws")],
    );
    expect(admitted.map((r) => r.runId)).toEqual(["pratt"]);
    expect(
      HostClaims.admit([run("pratt", urg("pratt"))], [urg("a"), urg("b")]),
    ).toEqual([]);
  });

  test("lets a later run start beside a run that must wait", () => {
    const admitted = HostClaims.admit(
      [
        run("central", urg("aws")),
        run("vinplus", { lanes: ["vinplus"], places: [] }),
      ],
      [urg("aws")],
    );
    expect(admitted.map((r) => r.runId)).toEqual(["vinplus"]);
  });

  test("needs every lane and place of a run that spans several", () => {
    const urgiis: HostClaims = {
      lanes: ["urg:eagle", "urg:66.42.115.19"],
      places: [{ group: "urg", capacity: 2 }],
    };
    expect(
      HostClaims.admit([run("urgiis", urgiis)], [urg("66.42.115.19")]),
    ).toEqual([]);
    expect(
      HostClaims.admit([run("urgiis", urgiis)], [urg("aws")]).map(
        (r) => r.runId,
      ),
    ).toEqual(["urgiis"]);
  });

  test("always admits runs that claim no host", () => {
    expect(
      HostClaims.admit(
        [run("row52", HostClaims.none)],
        [urg("a"), urg("b")],
      ).map((r) => r.runId),
    ).toEqual(["row52"]);
  });
});

describe("HostClaims.covers", () => {
  test("holds when every needed lane and group is already held", () => {
    expect(HostClaims.covers(urg("aws"), urg("aws"))).toBe(true);
    expect(HostClaims.covers(urg("aws"), HostClaims.none)).toBe(true);
    expect(HostClaims.covers(urg("eagle"), urg("66.42.115.19"))).toBe(false);
    expect(
      HostClaims.covers({ lanes: ["urg:aws"], places: [] }, urg("aws")),
    ).toBe(false);
  });
});
