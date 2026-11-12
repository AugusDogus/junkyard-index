// Compact native evidence from the 2026-11-12 frozen census, with images,
// scripts and layout removed. Identity words, VIN lines and part-out prose remain.
const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const document = (body: string) => `<html><body>${body}</body></html>`;
const contact =
  "5156 Rt 66 New Bethlehem, PA 16242, US 814-297-0163 Junkyard, Salvage Yard";
export const mccauleyNativeDetails = [
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2003-acura-mdx.html",
    label: "2003 MDX",
    heading: "2003 ACURA MDX AWD 4D SUV TOURING",
    paragraphs: [
      "2003 ACURA MDX AWD 4D SUV TOURING\nMileage: 132,760\nTransmission: Automatic\nVIN: 2HNYD18893H514298\n\nThis is one of two 03’ MDX’s. Many parts available.\n",
      "We have two of these 03' MDX's so most parts are available. Call to check or message 814-221-9900 and we'll get back to you ASAP.\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2010-chevy-2500.html",
    label: "2010 Silverado 2500",
    heading: "2010 CHEVROLET 2500HD SILVERADO 4WD V8 EXT CAB 6.0L LT",
    paragraphs: [
      "2010 CHEVROLET 2500HD\nMileage: 148,082\nTransmission: Automatic\nVIN : 1GC5KXBGXAZ188963\n\n\n",
      "LIMITED PARTS AVAILABLE. Please view pictures below. If you see what you need call to check if part is still available. Or message 814-221-9900 and we'll get back to you ASAP.\n\n\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2016-chevrolet-colorado.html",
    label: "2016 Colorado",
    heading: "2016 CHEVROLET COLORADO 4WD V6 CREW CAB 3.6L Z71",
    paragraphs: [
      "",
      "2016 Chevrolet Colorado\nMileage: 31,407\nTransmission: Automatic\nVIN: 1GCGTDE32G1200589\n",
      "Select parts will be priced below. For others please feel free to call us during business hours at 814-275-2025 or text message 814-221-9900 and we'll get back to you ASAP\n30 day warranty will be included on parts. Parts are intended for use under normal manufacturer's specifications.Warranty is void if used under any other application. There is no core charge on listed price.\n",
      "1. Bed has been sold\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2005-dodge-dakota.html",
    label: "2005 Dakota",
    heading: "2005 DODGE DAKOTA 4WD V6 EXT CAB 3.7L ST",
    paragraphs: [
      "2005 DODGE DAKOTA 4WD V6\nMileage: 130,318\nTransmission: Automatic\nVIN: 1D7HW22K05S139736\n",
      "LIMITED PARTS AVAILABLE. Please view pictures below. If you see what you need call to check if part is still available. Or message 814-221-9900 and we'll get back to you ASAP.\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2007-dodge-calibers.html",
    label: "2007 Caliber",
    heading: "2007 DODGE CALIBER FWD 4D HATCHBACK's",
    paragraphs: [
      "2007 DODGE CALIBER FWD 4D HATCHBACK SXT (RED)\nMileage: 95,833\nTransmission: Automatic\nVIN: 1B3HB48B07D328582\n\n2007 DODGE CALIBER FWD 4D HATCHBACK SXT (SILVER)\nMileage: 183,606\nTransmission: Automatic\nVIN : 1B3HB48B67D544811\n",
      "LIMITED PARTS AVAILABLE. Please view pictures below. If you see what you need call to check if part is still available. Or message 814-221-9900 and we'll get back to you ASAP.\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2008-dodge-avenger.html",
    label: "2008 Avenger",
    heading: "2008 DODGE AVENGER FWD 4C 4D SEDAN SE",
    paragraphs: [
      "2008 Dodge Avenger\nMileage: 150,492\nTransmission: Automatic\nVIN: 1B3LC46K98N670263\n",
      "For information on parts please feel free to call us during business hours at 814-275-2025 or text message 814-221-9900 and we'll get back to you ASAP\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2006-gmc-envoy.html",
    label: "2006 Envoy",
    heading: "2006 GMC ENVOY 4WD 6C 4D SUV",
    paragraphs: [
      "2006 GMC ENVOY 4WD 6C 4D SUV\nMileage: 186,524\nTransmission: Automatic\nVIN: 1GKDT13S562232445\n",
      "LIMITED PARTS AVAILABLE. Please view pictures below. If you see what you need call to check if part is still available. Or message 814-221-9900 and we'll get back to you ASAP.\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2004-jeep-liberty.html",
    label: "2004 Liberty",
    heading: "2004 JEEP LIBERTY 4WD V6 4D SUV LIMITED",
    paragraphs: [
      "2004 JEEP LIBERTY\nMileage: 163,787\nTransmission: Automatic\nVIN: 1J4GL58K74W105611\nSELLERS NOTES:\n*BAD ENGINE - makes knock\n*BAD TRANSMISSION\nall other parts are potentially available\n\n",
      "Please feel free to call us during business hours at 814-275-2025 or text message 814-221-9900 and we'll get back to you ASAP\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2006-jeep-grand-cherokee.html",
    label: "2006 Grand Cherokee",
    heading: "2006 JEEP GRAND CHEROKEE 4WD V6 4D SUV LAREDO",
    paragraphs: [
      "Transmission: Automatic\nMiles: 200,030\nVIN : 1J4GR48K06C109710\nBAD REAR END\n\n",
      "For parts please feel free to call us during business hours at 814-275-2025 or text message 814-221-9900 and we'll get back to you ASAP\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2011-kia-forte.html",
    label: "2011 Kia Forte",
    heading: "2011 KIA FORTE 4D SEDAN EX",
    paragraphs: [
      "Mileage: 67,611\nTransmission: Automatic\nVIN: KNAFU4A2XB5391893\n",
      "Select parts will be priced below. For others please feel free to call us during business hours at 814-275-2025 or text message 814-221-9900 and we'll get back to you ASAP\n",
      "30 day warranty will be included on parts. Parts are intended for use under normal manufacturer's specifications.Warranty is void if used under any other application. There is no core charge on listed price.\n",
      "Transmission 110k $300\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2008-mercury-milan.html",
    label: "2008 Milan",
    heading: "2008 MERCURY MILAN FWD 4C 4D SEDAN",
    paragraphs: [
      "2008 MERCURY MILAN FWD 4C 4D SEDAN\nMileage: 125,858\nTransmission: Automatic\nVIN : 3MEHM07Z88R641726\n",
      "LIMITED PARTS AVAILABLE. Please view pictures below. If you see what you need call to check if part is still available. Or message 814-221-9900 and we'll get back to you ASAP.\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2007-scion-tc.html",
    label: "2007 tC",
    heading: "2007 SCION TC 2D COUPE",
    paragraphs: [
      "2007 SCION TC 2D COUPE\nMileage: 108,687\nTransmission: Automatic\nVIN: JTKDE177670186710\n",
      "LIMITED PARTS AVAILABLE. Please view pictures below. If you see what you need call to check if part is still available. Or message 814-221-9900 and we'll get back to you ASAP.\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2001-subaru-forester.html",
    label: "2001 Forester",
    heading: "2001 SUBARU FORESTER AWD 4D SPORT UTILITY L",
    paragraphs: [
      "2001 SUBARU FORESTER AWD 4D SPORT UTILITY L\nVIN: JF1SF63541H755551\n",
      "Select parts may be priced below. For others please feel free to call us during business hours at 814-275-2025 or text message 814-221-9900 and we'll get back to you ASAP\n",
      "30 day warranty will be included on parts. Parts are intended for use under normal manufacturer's specifications.Warranty is void if used under any other application. There is no core charge on listed price.",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2008-subaru-impreza.html",
    label: "2008 Impreza",
    heading: "2008 SUBARU IMPREZA 4D SEDAN 2.5I",
    paragraphs: [
      "2008 Subaru Impreza\nMileage: 176,195\nTransmission: Automatic\nVIN: JF1GE61628H503098\n",
      "LIMITED PARTS AVAILABLE. Please view pictures below. If you see what you need call to check if part is still available. Or message 814-221-9900 and we'll get back to you ASAP.\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2008-subaru-outback.html",
    label: "2008 Outback",
    heading: "2008 SUBARU OUTBACK 4D WAGON",
    paragraphs: [
      "2008 Subaru Outback\nMileage: 109,877\nTransmission: Automatic\nVIN: 4S4BP60C487331938\n",
      "ENGINE $1,200\nTransmission $300\nRear Hatch $300\nFor information on parts please feel free to call us during business hours at 814-275-2025 or text message 814-221-9900 and we'll get back to you ASAP\n\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2009-subaru-forester.html",
    label: "2009 Forester",
    heading: "2009 SUBARU FORESTER 4D SPORT UTILITY 2.5X PREMIUM",
    paragraphs: [
      "2009 SUBARU FORESTER 4D SPORT UTILITY 2.5X PREMIUM\nMileage: 100,953\nTransmission: Automatic\nVIN: JF2SH63619H709881\n\n\n",
      "Select parts will be priced below. For others please feel free to call us during business hours at 814-275-2025 or text message 814-221-9900 and we'll get back to you ASAP\n",
      "30 day warranty will be included on parts. Parts are intended for use under normal manufacturer's specifications.Warranty is void if used under any other application. There is no core charge on listed price.",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2011-subaru-impreza1.html",
    label: "2011 Impreza",
    heading: "2011 SUBARU IMPREZA 4D WAGON OUTBACK SPORT",
    paragraphs: [
      "2011 SUBARU IMPREZA 4D WAGON OUTBACK SPORT\nMileage: 62,276\nTransmission: Automatic\nVIN: JF1GH6D67BH806596",
      "Select parts will be priced below. For others please feel free to call us during business hours at 814-275-2025 or text message 814-221-9900 and we'll get back to you ASAP\n",
      "30 day warranty will be included on parts. Parts are intended for use under normal manufacturer's specifications.Warranty is void if used under any other application. There is no core charge on listed price.\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2011-subaru-legacy.html",
    label: "2011 Legacy",
    heading: "2011 SUBARU LEGACY 4C 4D SEDAN 2.5I PREMIUM",
    paragraphs: [
      "2011 SUBARU LEGACY 4C 4D SEDAN 2.5I PREMIUM\nMileage: 121,849\nTransmission: Automatic\nVIN: 4S3BMBH6XB3218773\n\n",
      "Select parts may be priced below. For others please feel free to call us during business hours at 814-275-2025 or text message 814-221-9900 and we'll get back to you ASAP\n",
      "30 day warranty will be included on parts. Parts are intended for use under normal manufacturer's specifications.Warranty is void if used under any other application. There is no core charge on listed price.",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2012-subaru-outback.html",
    label: "2012 Outback",
    heading: "2012 SUBARU OUTBACK 4C 4D WAGON 2.5I PREMIUM",
    paragraphs: [
      "2012 Subaru Outback\nMileage: 238,157\nVIN : 4S4BRCGC9C3228691\nWest Virginia Inspection Sticker\n\n",
      "Select parts will be priced below. For others please feel free to call us during business hours at 814-275-2025 or text message 814-221-9900 and we'll get back to you ASAP\n\n",
      "30 day warranty will be included on parts. Parts are intended for use under normal manufacturer's specifications.Warranty is void if used under any other application. There is no core charge on listed price.\n",
    ],
  },
  {
    url: "http://mccauleysautocom.fatcow.com/mccauleysauto/parts-2013-subaru-impreza.html",
    label: "2013 Impreza",
    heading: "2013 SUBARU IMPREZA 4D SEDAN",
    paragraphs: [
      "2013 SUBARU IMPREZA 4D SEDAN\nVIN: JF1GJAA68DH026959\n",
      "Select parts will be priced below. For others please feel free to call us during business hours at 814-275-2025 or text message 814-221-9900 and we'll get back to you ASAP\n",
      "30 day warranty will be included on parts. Parts are intended for use under normal manufacturer's specifications.Warranty is void if used under any other application. There is no core charge on listed price.\n",
      "- Wheels $75 each with tire included\n- Transmission sold\n- Engine ran out of time\n",
    ],
  },
];
export const mccauleyNativeCurrent = [
  "Vehicle 001 2003 Acura MDX Touring w/Navi -VIN:2HNYD18893H514298",
  "Vehicle 002 2000 Chrysler 300M VIN: 2C3HE66G6YH439372",
  "Vehicle 003 2000 Jeep Grand Cherokee Laredo - VIN: 1J4GW48S3YC132300",
  "Vehicle 004 2002 Chevrolet TrailBlazer EXT LT - VIN: 1GNET16S726106884",
  "Vehicle 005 2011 Kia Forte EX VIN: KNAFU4A2XB5391893",
];
export const mccauleyCatalogHtml = () =>
  document(
    `<title>Parts Vehicles - Mccauleys Auto Llc</title>${contact}${mccauleyNativeDetails.map((post) => `<a href="${escape(post.url)}">${escape(post.label)}</a>`).join("")}`,
  );
export const mccauleyCurrentHtml = () =>
  document(
    `${contact}<h2>Salvage Vehicles</h2>Here are current vehicles we are parting out.${mccauleyNativeCurrent.map((heading) => `<div class="kv-ee-content-card"><h3>${escape(heading)}</h3></div>`).join("")}`,
  );
export const mccauleyDetailHtml = (
  detail: (typeof mccauleyNativeDetails)[number],
) =>
  document(
    `MCCAULEY'S AUTO <h2>${escape(detail.heading)}</h2>${detail.paragraphs.map((paragraph) => `<div class="paragraph">${paragraph.split("\n").map(escape).join("<br>")}</div>`).join("")}`,
  );
