import { describe, expect, mock, test } from "bun:test";
import { PassHandoff, type PassHandoffDependencies } from "./pass-handoff";

function dependencies(
  overrides: Partial<PassHandoffDependencies> = {},
): PassHandoffDependencies {
  return {
    findPass: async () => ({ runId: "wrun-pass", deploymentId: "dpl_new" }),
    currentDeployment: "dpl_new",
    replan: async () => "delivered",
    cancel: async () => undefined,
    startPass: async () => "wrun-new-pass",
    ...overrides,
  };
}

describe("PassHandoff.request", () => {
  test("asks a pass on current code to plan again", async () => {
    const cancel = mock(async () => undefined);
    expect(await PassHandoff.request(dependencies({ cancel }))).toEqual({
      via: "pass",
      runId: "wrun-pass",
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  test("replaces a pass on older code so the run starts on current code", async () => {
    const order: string[] = [];
    const replan = mock(async () => "delivered" as const);
    expect(
      await PassHandoff.request(
        dependencies({
          findPass: async () => ({
            runId: "wrun-old",
            deploymentId: "dpl_old",
          }),
          replan,
          cancel: async (runId) => {
            order.push(`cancel:${runId}`);
          },
          startPass: async () => {
            order.push("start");
            return "wrun-new-pass";
          },
        }),
      ),
    ).toEqual({ via: "restarted_pass", runId: "wrun-new-pass" });
    // The old pass releases the day's token before the new one claims it.
    expect(order).toEqual(["cancel:wrun-old", "start"]);
    expect(replan).not.toHaveBeenCalled();
  });

  test("starts a pass when none is listening, or the one found just ended", async () => {
    expect(
      await PassHandoff.request(dependencies({ findPass: async () => null })),
    ).toEqual({ via: "pass", runId: "wrun-new-pass" });
    expect(
      await PassHandoff.request(
        dependencies({ replan: async () => "no_pass" }),
      ),
    ).toEqual({ via: "pass", runId: "wrun-new-pass" });
  });

  test("keeps any pass outside Vercel, where no deployment can be compared", async () => {
    expect(
      await PassHandoff.request(
        dependencies({
          currentDeployment: undefined,
          findPass: async () => ({
            runId: "wrun-pass",
            deploymentId: "dpl_old",
          }),
        }),
      ),
    ).toEqual({ via: "pass", runId: "wrun-pass" });
  });
});
