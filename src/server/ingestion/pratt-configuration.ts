import type { PrattContract } from "./pratt-contract";
import { PRATT_ORIGIN } from "./pratt-html";

// Native AR18 contact identity and feature-matched business point:
// coverage/parallel-ak-hi/pratt-physical267-review47/report.json.
export const PRATT_YARD = {
  source: "pratt",
  code: "hoxie",
  name: "Pratt's Auto Salvage",
  operator: "Pratt's Auto Salvage",
  address: "170 Industrial Dr",
  city: "Hoxie",
  state: "AR",
  postalCode: "72433",
  phone: "800-348-6680",
  email: null,
  lat: 36.0533113,
  lng: -90.98447689999999,
  websiteUrl: PRATT_ORIGIN + "/",
} as const satisfies PrattContract["yard"];

export const PRATT_CONTRACT = {
  yard: PRATT_YARD,
  // Complete saved 468-model census: 5,930 clean unique candidates.
  minimumUniqueInventory: 5_000,
} satisfies PrattContract;
