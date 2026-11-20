export type InventoryFilterOptions = {
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
};

function withSelected(
  options: InventoryFilterOptions | undefined,
  selected: InventoryFilterOptions,
): InventoryFilterOptions {
  return {
    makes: [...new Set([...(options?.makes ?? []), ...selected.makes])].sort(),
    colors: [
      ...new Set([...(options?.colors ?? []), ...selected.colors]),
    ].sort(),
    states: [
      ...new Set([...(options?.states ?? []), ...selected.states]),
    ].sort(),
    salvageYards: [
      ...new Set([...(options?.salvageYards ?? []), ...selected.salvageYards]),
    ].sort(),
  };
}

export const InventoryFilterOptions = { withSelected } as const;
