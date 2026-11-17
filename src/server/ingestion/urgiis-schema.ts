// Data-only schemas used by durable workflows. Do not import HTML or HTTP code.
export {
  IisControlSchema as UrgiisControlSchema,
  IisRecordSchema as UrgiisRecordSchema,
  type IisControl as UrgiisControl,
  type IisRecord as UrgiisRecord,
} from "./iis-schema";

export interface UrgiisSite {
  origin: string;
  urgid: string;
  pathStyle: "parts" | "used-parts";
}

export const URGIIS_EMPTY_MODEL_MINIMUM = 3;
