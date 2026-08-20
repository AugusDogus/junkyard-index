import { start } from "workflow/api";
import { env } from "~/env";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";
import { davieProbeWorkflow } from "~/workflows/davie-probe";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const run = await start(davieProbeWorkflow);
  const report = await run.returnValue;
  return Response.json({ runId: run.runId, report });
}
