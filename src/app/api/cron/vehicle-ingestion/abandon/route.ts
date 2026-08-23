import { z } from "zod";
import { getRun } from "workflow/api";
import { env } from "~/env";
import { abandonDurableIngestion } from "~/server/ingestion/durable-ingestion";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";

const AbandonRequest = z.object({
  runId: z.string().min(1),
  force: z.boolean().default(false),
});

export async function POST(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = AbandonRequest.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid abandon request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const workflowRunId = await abandonDurableIngestion(
      parsed.data.runId,
      parsed.data.force,
    );
    let workflowCancellation: "cancelled" | "not_attached" | "failed" =
      "not_attached";
    if (workflowRunId) {
      try {
        await getRun(workflowRunId).cancel();
        workflowCancellation = "cancelled";
      } catch (error) {
        workflowCancellation = "failed";
        console.error("Failed to cancel abandoned ingestion Workflow", {
          runId: parsed.data.runId,
          workflowRunId,
          error,
        });
      }
    }
    return Response.json({
      message: "Ingestion run abandoned",
      runId: parsed.data.runId,
      forced: parsed.data.force,
      workflowRunId,
      workflowCancellation,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to abandon run",
      },
      { status: 409 },
    );
  }
}
