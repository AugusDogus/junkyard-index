import { assessIisRecord } from "./iis-record";
import { alliedOwnedUrl } from "./allied-html";
import { IisModelRoute } from "./iis-model-route";
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
    // Donor links spell a published "_-and_" model segment as "_and__".
    const donor = IisModelRoute.donorControl;
    return assessIisRecord(
      record,
      context.kind === "model"
        ? { ...context, model: donor(context.model) }
        : context,
      { ownedUrl: alliedOwnedUrl, pathStyle: "parts", requireInquiry: true },
      published.map(({ make, model }) => ({ make, model: donor(model) })),
    );
  },
} as const;
