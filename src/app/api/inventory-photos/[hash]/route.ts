import { env } from "~/env";
import { donorPhotoResponse } from "~/server/ingestion/donor-photo-response";
import { DonorPhotoStore } from "~/server/ingestion/donor-photo-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params;
  return donorPhotoResponse(
    hash,
    DonorPhotoStore.vercelBlob(env.BLOB_READ_WRITE_TOKEN),
  );
}
