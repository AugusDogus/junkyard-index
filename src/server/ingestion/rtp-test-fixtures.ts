import type { RtpRecord, RtpYard } from "./rtp-client";
import type { RtpYardCode } from "./rtp-cursor";
import { RTP_YARDS } from "./rtp-yard-metadata";
export const rtpTestYard: RtpYard = {
  source: "rtp",
  code: "595",
  operator: "RTP Pick-A-Part",
  name: "RTP Pick-A-Part - Lexington, KY",
  address: "351 E 7th St.",
  city: "Lexington",
  state: "KY",
  postalCode: "40508",
  lat: 38.05179,
  lng: -84.47859,
  phone: "(859) 586-3505",
  email: null,
  websiteUrl: "https://upullandsave.com/lexington-ky/rtp-pick-a-part/",
};
export const rtpTestRecord = {
  id: "386619",
  yard_id: "595",
  year: "2010",
  make: "Chevrolet",
  model: "Tahoe",
  stock_number: "000000109287",
  color: "BLACK",
  vin: "1GNUKAE0XAR173989",
  yard_row: "207",
  images: [
    { full: "https://upullandsave.com/yardsmart/595/386619/6940706.jpg" },
  ],
  status: "set",
  active: "1",
  date_set: "2026-09-08 09:07:15",
} satisfies RtpRecord;

export function rtpTestContext(code: RtpYardCode): string {
  const config = RTP_YARDS[code];
  const location = {
    options: { active: true, identifier: "not-the-native-yard-id" },
    label: {
      long_label: rtpTestYard.name,
      short_label: code === "298" ? "Raceway Pik-A-Part" : "RTP Pick-A-Part",
    },
    address: {
      street_address: rtpTestYard.address,
      city: rtpTestYard.city,
      state: config.state,
      zip: rtpTestYard.postalCode,
      latitude: String(rtpTestYard.lat),
      longitude: String(rtpTestYard.lng),
    },
    contact: { phone: rtpTestYard.phone, email: "" },
    links: { home: config.home, inventory: `${config.home}inventory/` },
    integrations: { yardsmart: { use_yardsmart: true, yard_id: code } },
  };
  return `<html><script>$rtp.o.theme_options = ${JSON.stringify({ locations: [location] })};
    $rtp.o.ajax = { url: 'https://upullandsave.com/wp-admin/admin-ajax.php', nonce: 'testnonce', actions: ["inventory"] };</script>
    <input class="search-form-yard-id" value="${code}"></html>`;
}
