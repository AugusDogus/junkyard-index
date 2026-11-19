import { ConsumerBrand } from "./consumer-brand";
import { ConsumerModel } from "./consumer-model";
import { VehicleName } from "./vehicle-name";

function resolve(input: ConsumerModel & { sourceMake?: string | null }) {
  const brand = ConsumerBrand.resolve(
    input.make,
    input.model,
    input.sourceMake,
  );
  return {
    make: brand.make,
    model: ConsumerModel.resolve({
      ...input,
      ...brand,
      sourceModel: input.sourceModel
        ? VehicleName.modelName(
            input.sourceMake ?? input.make,
            input.sourceModel,
          )
        : input.sourceModel,
    }),
  };
}

export const ConsumerIdentity = { resolve } as const;
