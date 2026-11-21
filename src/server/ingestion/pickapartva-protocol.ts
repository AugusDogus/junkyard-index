import { inventoryHtmlAttribute } from "./inventory-html";
import {
  pickapartvaClass,
  pickapartvaDecode,
  pickapartvaDivs,
  pickapartvaText,
} from "./pickapartva-html";
import {
  PICKAPARTVA_MAX_PAGES,
  PICKAPARTVA_YARDS,
  pickapartvaPageUrl,
  type PickapartvaSearchScope,
} from "./pickapartva-yard-metadata";

/** The unfiltered selector may leave ANY implicit; a yard search must select
 * exactly that yard. */
const selectedScope = (
  selected: Array<string | null>,
  id: PickapartvaSearchScope,
) =>
  id === "ANY"
    ? selected.every((value) => value === "ANY")
    : selected.length === 1 && selected[0] === id;

/** `search` is the expected native search term: empty for the catalog pages,
 * the Set Date for a set-date search. `id` is the expected physical scope:
 * every yard, or the one yard a split set-date search selects. */
export function verifyPickapartvaOwner(
  html: string,
  raw: string,
  search = "",
  id: PickapartvaSearchScope = "ANY",
) {
  const plain = pickapartvaText(html);
  if (
    ![
      "Search Our Vehicles",
      "U-Pull-It Inventory",
      "Pick-A-Part Recycled Auto Parts",
      "Vehicles listed in rows 700 - 799",
      "rows 1-99 are not U-Pick vehicles",
    ].every((value) => plain.includes(value)) ||
    !Object.values(PICKAPARTVA_YARDS).every((yard) =>
      [yard.address, yard.city, yard.postalCode, yard.phone].every((value) =>
        plain.includes(value),
      ),
    )
  )
    throw new Error(
      "Pick-A-Part VA active donor ownership or physical yard footer changed",
    );
  const owners = [
    ...raw.matchAll(/\bvar\s+iisupullurgid\s*=\s*['"]([^'"]+)['"]/g),
  ];
  if (!owners.length || owners.some((match) => match[1] !== "TT87,UU81"))
    throw new Error("Pick-A-Part VA native inventory owner codes changed");
  const selectors = [
    ...html.matchAll(/(<select\b[^>]*>)([\s\S]*?)<\/select>/gi),
  ].filter((match) => pickapartvaClass(match[1] ?? "", "upullsimpleLocation"));
  if (selectors.length !== 1)
    throw new Error(
      "Pick-A-Part VA physical yard selector is missing or duplicated",
    );
  const options = [
    ...(selectors[0]?.[2] ?? "").matchAll(
      /(<option\b[^>]*>)([\s\S]*?)<\/option>/gi,
    ),
  ].filter((match) => inventoryHtmlAttribute(match[1] ?? "", "value") !== null);
  if (
    JSON.stringify(
      options.map((match) => [
        inventoryHtmlAttribute(match[1] ?? "", "value"),
        pickapartvaText(match[2] ?? ""),
      ]),
    ) !==
      JSON.stringify([
        ["ANY", "ANY"],
        ["TT87", "Fredericksburg"],
        ["UU81", "Stafford"],
      ]) ||
    !selectedScope(
      options
        .filter(
          (match) =>
            inventoryHtmlAttribute(match[1] ?? "", "selected") !== null,
        )
        .map((match) => inventoryHtmlAttribute(match[1] ?? "", "value")),
      id,
    )
  )
    throw new Error(
      "Pick-A-Part VA inventory selector has changed or narrowed physical scope",
    );
  const forms = [
    ...html.matchAll(/(<form\b[^>]*>)([\s\S]*?)<\/form>/gi),
  ].filter((match) =>
    pickapartvaClass(match[1] ?? "", "iis-upull-search-form"),
  );
  if (!forms.length)
    throw new Error("Pick-A-Part VA unfiltered search controls are missing");
  for (const form of forms) {
    const inputs = [...(form[2] ?? "").matchAll(/<input\b[^>]*>/gi)].map(
      ([tag]) => [
        inventoryHtmlAttribute(tag, "name"),
        inventoryHtmlAttribute(tag, "value"),
      ],
    );
    if (
      inventoryHtmlAttribute(form[1] ?? "", "action") !==
        "/inventory/ANY/ANY/" ||
      inventoryHtmlAttribute(form[1] ?? "", "method")?.toLowerCase() !==
        "get" ||
      JSON.stringify(inputs) !==
        JSON.stringify([
          ["k", "1"],
          ["id", id],
          ["search", search],
        ])
    )
      throw new Error("Pick-A-Part VA inventory form is filtered or changed");
  }
}

export function parsePickapartvaPagination(html: string, page: number) {
  const groups = [...html.matchAll(/(<ul\b[^>]*>)([\s\S]*?)<\/ul>/gi)].filter(
    (match) => pickapartvaClass(match[1] ?? "", "pagination"),
  );
  if (!groups.length)
    throw new Error("Pick-A-Part VA explicit pagination is missing");
  const controls = groups.map((group) => {
    const items = [
      ...(group[2] ?? "").matchAll(/(<li\b[^>]*>)([\s\S]*?)<\/li>/gi),
    ];
    const links = items.flatMap((item) =>
      [...(item[2] ?? "").matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].map(
        (anchor) => {
          const raw = inventoryHtmlAttribute(anchor[1] ?? "", "href");
          const url =
            raw === null ? null : pickapartvaPageUrl(pickapartvaDecode(raw));
          if (!url)
            throw new Error(
              "Pick-A-Part VA pagination has a foreign or filtered URL",
            );
          return {
            url,
            label: pickapartvaText(anchor[2] ?? ""),
            active: pickapartvaClass(item[1] ?? "", "active"),
            number: Number(new URL(url).searchParams.get("pagenum")),
          };
        },
      ),
    );
    const active = links.filter((link) => link.active);
    const lastPage = Math.max(...links.map((link) => link.number));
    const next = links.filter((link) => link.label === "Next »");
    const previous = links.filter((link) => link.label === "« Previous");
    if (
      active.length !== 1 ||
      active[0]?.number !== page ||
      active[0]?.label !== String(page) ||
      lastPage < page ||
      lastPage > PICKAPARTVA_MAX_PAGES ||
      (page < lastPage
        ? next.length !== 1 || next[0]?.number !== page + 1
        : next.length !== 0) ||
      (page > 1
        ? previous.length !== 1 || previous[0]?.number !== page - 1
        : previous.length !== 0) ||
      links.some(
        (link) =>
          !["Next »", "« Previous", String(link.number)].includes(link.label),
      )
    )
      throw new Error(
        "Pick-A-Part VA current page, continuation or terminal controls changed",
      );
    return { lastPage, nextUrl: next[0]?.url ?? null, links };
  });
  if (new Set(controls.map((control) => JSON.stringify(control))).size !== 1)
    throw new Error("Pick-A-Part VA duplicated pagination controls disagree");
  const control = controls[0];
  if (!control) throw new Error("Pick-A-Part VA pagination is empty");
  return control;
}

/** A set-date search publishes every match on one page: it has no pagination
 * list and its pagination toolbars are empty. */
export function verifyPickapartvaSearchTerminal(html: string) {
  const toolbars = pickapartvaDivs(html, "iis-upull-toolbar-pagination");
  if (
    !toolbars.length ||
    toolbars.some((toolbar) => !/^\s*$/.test(toolbar.body)) ||
    [...html.matchAll(/<ul\b[^>]*>/gi)].some(([tag]) =>
      pickapartvaClass(tag, "pagination"),
    )
  )
    throw new Error(
      "Pick-A-Part VA set-date search has a continuation or changed pagination controls",
    );
}
