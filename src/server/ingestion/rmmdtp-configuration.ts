import type { RmmdtpContract } from "./rmmdtp-contract";

// UT36 native identity and AL60 independently matched physical business point.
// The native street adds North; Maps supplies ZIP 84307 and omits North.
export const RMMDTP_YARD = {
  source: "rmmdtp",
  code: "corinne",
  name: "Rocky Mountain Medium Duty Truck Parts",
  operator: "Rocky Mountain Medium Duty Truck Parts",
  address: "2715 North Mule Ranch Circle",
  city: "Corinne",
  state: "UT",
  postalCode: "84307",
  phone: "801-781-1015",
  email: "nelsonstruckparts@gmail.com",
  lat: 41.5556051,
  lng: -112.12348,
  websiteUrl: "https://rmmdtp.com/",
} as const satisfies RmmdtpContract["yard"];
export const RMMDTP_CONTRACT = {
  yard: RMMDTP_YARD,
  // Root-approved minimum after UT36/MT22 full saved-native qualification.
  minimumUniqueInventory: 80,
} satisfies RmmdtpContract;
