type YardIdentity = {
  source: string;
  name: string;
  city: string;
  state: string;
  detailsUrl: string | null;
};

const operatorHosts = new Map<string, readonly string[]>([
  ["pullapart", ["pullapart.com", "upullandpay.com"]],
  ["pyp", ["pyp.com"]],
  ["gopullit", ["gopullit.com"]],
  ["upullitne", ["upullitne.com"]],
  ["upullitdavie", ["upullitdavie.com"]],
]);

export function getYardDetails(yard: YardIdentity) {
  const url = yard.detailsUrl ? URL.parse(yard.detailsUrl) : null;
  const host = url?.hostname.replace(/^www\./, "");
  // Row52 and AutoRecycler host inventory for independent yards. Their
  // vehicle URLs do not identify the yard's own website.
  const websiteUrl =
    url &&
    (url.protocol === "https:" || url.protocol === "http:") &&
    !url.username &&
    !url.password &&
    host &&
    operatorHosts.get(yard.source)?.includes(host)
      ? `${url.origin}/`
      : null;

  let name = yard.name;
  if (
    yard.source === "pullapart" &&
    !/pull[\s-]*a[\s-]*part|u[\s-]*pull/i.test(name)
  ) {
    const operator = websiteUrl
      ? host === "upullandpay.com"
        ? "U-Pull-&-Pay"
        : "Pull-A-Part"
      : "Pull-A-Part / U-Pull-&-Pay";
    name = `${operator} - ${name}`;
  } else if (yard.source === "pyp" && !/pick your part/i.test(name)) {
    name = `LKQ Pick Your Part - ${name}`;
  }

  // Some inventory coordinates locate a ZIP centroid, so search by business
  // name and city instead of sending visitors to those coordinates.
  const mapsQuery = new URLSearchParams({
    api: "1",
    query: `${name}, ${yard.city}, ${yard.state}`,
  });
  return {
    name,
    websiteUrl,
    mapsUrl: `https://www.google.com/maps/search/?${mapsQuery}`,
  };
}
