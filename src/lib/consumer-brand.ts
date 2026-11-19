import { VehicleName } from "./vehicle-name";

// Corporate decoder labels may describe several consumer brands. A sibling
// brand (Chevrolet vs GMC, for example) never qualifies as a parent.
const SOURCE_BRANDS: Readonly<Record<string, readonly string[]>> = {
  TOYOTA: ["SCION", "LEXUS"],
  GM: [
    "CHEVROLET",
    "GMC",
    "BUICK",
    "CADILLAC",
    "SATURN",
    "PONTIAC",
    "OLDSMOBILE",
    "HUMMER",
    "GEO",
  ],
  GENERALMOTORS: [
    "CHEVROLET",
    "GMC",
    "BUICK",
    "CADILLAC",
    "SATURN",
    "PONTIAC",
    "OLDSMOBILE",
    "HUMMER",
    "GEO",
  ],
  FORD: ["MERCURY", "LINCOLN"],
  CHRYSLER: ["PLYMOUTH"],
  CHEVROLET: ["GEO"],
  MERCEDESBENZ: ["SMART"],
  DAIMLER: ["SMART"],
  DODGE: ["RAM"],
};
const MODEL_BRANDS: Readonly<Record<string, readonly string[]>> = {
  TOYOTA: ["Scion"],
  CHEVROLET: ["Geo"],
};
const SCION_MODELS: Readonly<Record<string, string>> = {
  TC: "tC",
  XA: "xA",
  XB: "xB",
  XD: "xD",
  IQ: "iQ",
  IA: "iA",
  IM: "iM",
  FRS: "FR-S",
};

function resolve(make: string, model: string, sourceMake?: string | null) {
  const parent = VehicleName.makeKey(make) ?? "";
  const prefix = MODEL_BRANDS[parent]?.find((brand) =>
    model.toLowerCase().startsWith(`${brand.toLowerCase()} `),
  );
  const sourceKey = sourceMake ? VehicleName.makeKey(sourceMake) : null;
  const consumerMake =
    prefix ??
    (sourceKey && SOURCE_BRANDS[parent]?.includes(sourceKey) && sourceMake
      ? VehicleName.makeName(sourceMake)
      : make);
  const consumerModel = VehicleName.modelName(consumerMake, model);
  return {
    make: consumerMake,
    model:
      VehicleName.makeKey(consumerMake) === "SCION"
        ? (SCION_MODELS[
            consumerModel.toUpperCase().replace(/[^A-Z0-9]/g, "")
          ] ?? consumerModel)
        : consumerModel,
  };
}

export const ConsumerBrand = { resolve } as const;
