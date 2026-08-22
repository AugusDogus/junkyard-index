export interface CrushMvcYard {
  yardId: number | null;
  name: string;
  city: string | null;
  stateAbbr: string | null;
  lat: number | null;
  lng: number | null;
}

export interface CrushMvcSiteConfig {
  siteId: string;
  displayName: string;
  baseUrl: string;
  inventoryPath: string;
  yards: CrushMvcYard[];
}

export const CRUSH_MVC_SITES: readonly CrushMvcSiteConfig[] = [
  {
    siteId: "pick-a-part-jalopy-jungle",
    displayName: "Pick-A-Part Jalopy Jungle",
    baseUrl: "https://inventory.pickapartjalopyjungle.com",
    inventoryPath: "/",
    yards: [
      {
        yardId: 1020,
        name: "Boise",
        city: "Boise",
        stateAbbr: "ID",
        lat: 43.615,
        lng: -116.2023,
      },
      {
        yardId: 1021,
        name: "Caldwell",
        city: "Caldwell",
        stateAbbr: "ID",
        lat: 43.6694,
        lng: -116.6874,
      },
      {
        yardId: 1119,
        name: "Garden City",
        city: "Garden City",
        stateAbbr: "ID",
        lat: 43.6196,
        lng: -116.256,
      },
      {
        yardId: 1022,
        name: "Nampa",
        city: "Nampa",
        stateAbbr: "ID",
        lat: 43.5407,
        lng: -116.5635,
      },
      {
        yardId: 1099,
        name: "Twin Falls",
        city: "Twin Falls",
        stateAbbr: "ID",
        lat: 42.5558,
        lng: -114.4701,
      },
    ],
  },
  {
    siteId: "u-jerk-it",
    displayName: "U Jerk It / Rack Auto Parts",
    baseUrl: "https://ujerkit.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "Lakeland",
        city: "Lakeland",
        stateAbbr: "FL",
        lat: 28.0395,
        lng: -81.9498,
      },
    ],
  },
  {
    siteId: "youngstown-u-pull-it",
    displayName: "Youngstown U-Pull-It",
    baseUrl: "https://youngstownupullit.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "Youngstown",
        city: "Youngstown",
        stateAbbr: "OH",
        lat: 41.0998,
        lng: -80.6495,
      },
    ],
  },
  {
    siteId: "u-pull-it-auto-parts",
    displayName: "U-Pull-It Auto Parts",
    baseUrl: "https://www.upullitap.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: 1079,
        name: "Memphis",
        city: "Memphis",
        stateAbbr: "TN",
        lat: 35.1495,
        lng: -90.049,
      },
      {
        yardId: 1196,
        name: "Millington",
        city: "Millington",
        stateAbbr: "TN",
        lat: 35.3432,
        lng: -89.887,
      },
    ],
  },
  {
    siteId: "cps-u-pull-it",
    displayName: "CP's U-Pull-It",
    baseUrl: "https://cpsupullit.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "Dalton",
        city: "Dalton",
        stateAbbr: "GA",
        lat: 34.7698,
        lng: -84.9702,
      },
    ],
  },
  {
    siteId: "pipes-u-pull-it",
    displayName: "Pipes U-Pull-It",
    baseUrl: "https://pipesupullit.net",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "Shreveport",
        city: "Shreveport",
        stateAbbr: "LA",
        lat: 32.5252,
        lng: -93.7502,
      },
    ],
  },
  {
    siteId: "ss-u-pull-it",
    displayName: "S&S U-Pull-It",
    baseUrl: "https://www.ssupullit.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "Lebanon",
        city: "Lebanon",
        stateAbbr: "MO",
        lat: 37.6806,
        lng: -92.6627,
      },
    ],
  },
  {
    siteId: "mm-u-pull-it",
    displayName: "M&M U-Pull-It",
    baseUrl: "https://www.mmupullit.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "M&M U-Pull-It",
        city: null,
        stateAbbr: null,
        lat: null,
        lng: null,
      },
    ],
  },
  {
    siteId: "buddys-upull",
    displayName: "Buddy's Upull",
    baseUrl: "https://www.buddysupull.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "Buddy's Upull",
        city: null,
        stateAbbr: null,
        lat: null,
        lng: null,
      },
    ],
  },
  {
    siteId: "pickers-texarkana",
    displayName: "Pickers Self-Service Auto Parts",
    baseUrl: "https://pickerstxk.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "Texarkana",
        city: "Texarkana",
        stateAbbr: "AR",
        lat: 33.4418,
        lng: -94.0377,
      },
    ],
  },
  {
    siteId: "pickers-reno",
    displayName: "Pickers Self-Service Auto Parts",
    baseUrl: "https://www.pickersreno.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "Reno",
        city: "Reno",
        stateAbbr: "TX",
        lat: 33.6382,
        lng: -95.4755,
      },
    ],
  },
  {
    siteId: "pickers-longview",
    displayName: "Pickers Self-Service Auto Parts",
    baseUrl: "https://www.pickerslongview.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "Longview",
        city: "Longview",
        stateAbbr: "TX",
        lat: 32.5007,
        lng: -94.7405,
      },
    ],
  },
  {
    siteId: "hh-salvage-amarillo",
    displayName: "H & H Salvage U Pull It",
    baseUrl: "https://www.handhsalvageamarillo.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "Amarillo",
        city: "Amarillo",
        stateAbbr: "TX",
        lat: 35.222,
        lng: -101.8313,
      },
    ],
  },
  {
    siteId: "hwy-195-auto-parts",
    displayName: "Hwy 195 Auto Parts",
    baseUrl: "https://www.195usedautoparts.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "Killeen",
        city: "Killeen",
        stateAbbr: "TX",
        lat: 31.1171,
        lng: -97.7278,
      },
    ],
  },
  {
    siteId: "sturtevant-auto",
    displayName: "Sturtevant Auto",
    baseUrl: "https://inventory.sturtevantauto.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "Sturtevant",
        city: "Sturtevant",
        stateAbbr: "WI",
        lat: 42.7431,
        lng: -87.9434,
      },
    ],
  },
  {
    siteId: "662-self-serve-auto-parts",
    displayName: "662 Self Serve Auto Parts",
    baseUrl: "https://662selfserveautoparts.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "Corinth",
        city: "Corinth",
        stateAbbr: "MS",
        lat: 34.9343,
        lng: -88.5129,
      },
    ],
  },
  {
    siteId: "marion-county-auto-parts",
    displayName: "Marion County Auto Parts and Salvage",
    baseUrl: "https://www.marioncountyautoparts.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "Belleview",
        city: "Belleview",
        stateAbbr: "FL",
        lat: 29.0586,
        lng: -82.2095,
      },
    ],
  },
  {
    siteId: "polk-county-pick-and-pay",
    displayName: "Polk County Pick and Pay",
    baseUrl: "https://www.polkcountypickandpay.com",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "Polk County",
        city: null,
        stateAbbr: "FL",
        lat: null,
        lng: null,
      },
    ],
  },
];
