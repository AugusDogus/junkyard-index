import { runIngestionPipeline } from "./run-pipeline";
type IngestionRunResult = Awaited<ReturnType<typeof runIngestionPipeline>>;

export async function runIngestion(): Promise<IngestionRunResult> {
  return runIngestionPipeline();
}
