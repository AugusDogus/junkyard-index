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
    const result = await abandonDurableIngestion({
      runId: parsed.data.runId,
      force: parsed.data.force,
      cancelWorkflow: (workflowRunId) => getRun(workflowRunId).cancel(),
    });
    if (result.status === "already_ended") {
      return Response.json({
        message: `Ingestion run ${result.runId} already ended (${result.runStatus}), so nothing was abandoned.`,
        ...result,
      });
    }
    return Response.json({
      message: "Ingestion run abandoned",
      runId: parsed.data.runId,
      forced: parsed.data.force,
      workflowRunId: result.abandoned.workflowRunId,
      ...result,
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
