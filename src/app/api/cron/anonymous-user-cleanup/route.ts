import { env } from "~/env";
import { db } from "~/lib/db";
import { deleteExpiredAnonymousUsers } from "~/server/auth/anonymous-user-cleanup";
import { hasValidCronAuthorization } from "~/server/workflows/cron-authorization";

export async function GET(request: Request) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deletedUsers = await deleteExpiredAnonymousUsers({
    database: db,
    now: new Date(),
  });
  return Response.json({ deletedUsers });
}
