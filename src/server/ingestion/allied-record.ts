import { assessIisRecord } from "./iis-record";
import { alliedOwnedUrl } from "./allied-html";
import type { IisRecord, IisContext, IisControl } from "./iis-record";
export {
  IisControlSchema as AlliedControlSchema,
  IisContextSchema as AlliedContextSchema,
  IisRecordSchema as AlliedRecordSchema,
  type IisControl as AlliedControl,
  type IisContext as AlliedContext,
  type IisNativeIdentity as AlliedNativeIdentity,
  type IisAssessment as AlliedAssessment,
} from "./iis-record";
import { IisRecordSchema } from "./iis-record";
export type AlliedRecord = IisRecord;
export const AlliedRecord = {
  schema: IisRecordSchema,
  assess(
    record: IisRecord,
    context: IisContext,
    published: readonly { make: IisControl; model: IisControl }[] = [],
  ) {
    return assessIisRecord(
      record,
      context,
      { ownedUrl: alliedOwnedUrl, pathStyle: "parts", requireInquiry: true },
      published,
    );
  },
} as const;
