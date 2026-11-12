import {
  inventoryHtmlAttribute,
  inventoryTableSections,
  stripInventoryRawText,
} from "./inventory-html";
import { ARMY_INVENTORY_URL } from "./army-yard-metadata";

export interface ArmyRecord {
  id: string;
  make: string;
  model: string;
  year: string;
  color: string;
  stock: string;
  vin: string;
}

function text(raw: string, mode: "required" | "optional" = "required"): string {
  const named = new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
    ["nbsp", " "],
  ]);
  let valid = true;
  const decoded = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = named.get(key.toLowerCase());
        if (value === undefined) valid = false;
        return value ?? "";
      }
      const hex = key.slice(0, 2).toLowerCase() === "#x";
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      ) {
        valid = false;
        return "";
      }
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
  if (mode === "optional" && decoded.length > 300) return "";
  if (valid) return decoded;
  if (mode === "optional") return "";
  throw new Error(
    "Army required donor field contains an unsupported or invalid character reference",
  );
}

function hasClass(tag: string, name: string): boolean {
  return (
    inventoryHtmlAttribute(tag, "class")?.split(/\s+/).includes(name) ?? false
  );
}

function verifyScope(clean: string) {
  // Decode only the native ownership punctuation here. Footer entities are not
  // donor fields and must not pass through the strict donor entity decoder.
  const plain = clean
    .replace(/<[^>]*>/g, " ")
    .replace(/&#0*39;|&#8217;|&apos;|’/gi, "'")
    .replace(/\s+/g, " ");
  if (
    !plain.includes(
      "Army's is the largest and most up to date self service parts yard in the area.",
    ) ||
    !plain.includes("Army's Auto Wrecking") ||
    !/1510 St\.? John's Rd\.?/.test(plain) ||
    !/Lima,? OH 45804/.test(plain) ||
    !plain.includes("567.371.1244")
  )
    throw new Error(
      "Army active self-service scope or physical yard identity changed",
    );
  const canonical = [...clean.matchAll(/<link\b[^>]*>/gi)].filter(
    ([tag]) => inventoryHtmlAttribute(tag, "rel") === "canonical",
  );
  if (
    canonical.length !== 1 ||
    inventoryHtmlAttribute(canonical[0]?.[0] ?? "", "href") !==
      ARMY_INVENTORY_URL
  )
    throw new Error("Army inventory canonical URL changed or is filtered");
  const forms = [
    ...clean.matchAll(/(<form\b[^>]*>)([\s\S]*?)<\/form>/gi),
  ].filter((match) => /id=["']vehicle-make["']/.test(match[2] ?? ""));
  const form = forms[0];
  if (
    forms.length !== 1 ||
    inventoryHtmlAttribute(form?.[1] ?? "", "action") !== "" ||
    /<input\b/i.test(form?.[2] ?? "")
  )
    throw new Error("Army unfiltered inventory form changed");
  const selects = [
    ...(form?.[2] ?? "").matchAll(/(<select\b[^>]*>)([\s\S]*?)<\/select>/gi),
  ];
  if (selects.length !== 4)
    throw new Error("Army inventory filter count changed");
  for (const name of [
    "vehicle-make",
    "vehicle-model",
    "vehicle-start-year",
    "vehicle-end-year",
  ]) {
    const matches = selects.filter(
      (match) => inventoryHtmlAttribute(match[1] ?? "", "name") === name,
    );
    const select = matches[0];
    if (
      matches.length !== 1 ||
      inventoryHtmlAttribute(select?.[1] ?? "", "id") !== name
    )
      throw new Error("Army inventory filter identity changed");
    const options = [
      ...(select?.[2] ?? "").matchAll(
        /(<option\b[^>]*>)([\s\S]*?)<\/option>/gi,
      ),
    ];
    const selected = options.filter(
      (match) => inventoryHtmlAttribute(match[1] ?? "", "selected") !== null,
    );
    const choices = selected.filter(
      (match) => inventoryHtmlAttribute(match[1] ?? "", "value") !== null,
    );
    if (
      selected.filter((match) => text(match[2] ?? "") === "Choose...")
        .length !== 1
    )
      throw new Error("Army inventory default filter placeholder changed");
    if (name === "vehicle-make" || name === "vehicle-model") {
      if (choices.length !== 0 || selected.length !== 1)
        throw new Error("Army inventory has a selected make/model filter");
    } else {
      const years = options.flatMap((match) => {
        const value = inventoryHtmlAttribute(match[1] ?? "", "value");
        if (value === null && text(match[2] ?? "") === "Choose...") return [];
        if (
          value === null ||
          !/^\d{4}$/.test(value) ||
          text(match[2] ?? "") !== value
        )
          throw new Error("Army inventory year choices changed");
        return [Number(value)];
      });
      const expected =
        name === "vehicle-start-year" ? Math.min(...years) : Math.max(...years);
      if (
        years.length === 0 ||
        choices.length !== 1 ||
        selected.length !== 2 ||
        Math.min(...years) !== 1960 ||
        inventoryHtmlAttribute(choices[0]?.[1] ?? "", "value") !==
          String(expected)
      )
        throw new Error(
          "Army inventory year filters exclude published choices",
        );
    }
  }
  for (const [tag] of clean.matchAll(/<a\b[^>]*>/gi)) {
    const href = inventoryHtmlAttribute(tag, "href");
    const url =
      href === null
        ? null
        : URL.parse(
            href.replace(/&amp;|&#0*38;|&#x0*26;/gi, "&"),
            ARMY_INVENTORY_URL,
          );
    if (
      inventoryHtmlAttribute(tag, "rel")?.split(/\s+/).includes("next") ||
      (url?.origin === new URL(ARMY_INVENTORY_URL).origin &&
        url.pathname === "/self-service-inventory/" &&
        [...url.searchParams.keys()].some((key) =>
          /^(?:page|paged|offset|cursor|limit)$/i.test(key),
        ))
    )
      throw new Error("Army inventory introduced an unverified continuation");
  }
}

function modalFields(raw: string): Pick<ArmyRecord, "id" | "vin" | "stock"> {
  const buttons = [...raw.matchAll(/<button\b[^>]*>/gi)].filter(([tag]) =>
    hasClass(tag, "vehicleModalButton"),
  );
  const button = buttons[0]?.[0] ?? "";
  const id = inventoryHtmlAttribute(button, "data-id");
  if (
    buttons.length !== 1 ||
    id === null ||
    !/^[1-9]\d{0,9}$/.test(id) ||
    inventoryHtmlAttribute(button, "data-bs-target") !== "#vehicleModal" + id
  )
    throw new Error("Army donor modal identity changed");
  const divs = [...raw.matchAll(/<\/?div\b[^>]*>/gi)];
  let depth = 0;
  let modals = 0;
  let modalStart = 0;
  let modalDepth = 0;
  let modal: string | null = null;
  for (const match of divs) {
    const tag = match[0];
    if (/^<\//.test(tag)) {
      if (depth === modalDepth && modal === null)
        modal = raw.slice(modalStart, match.index);
      depth--;
    } else {
      depth++;
      if (inventoryHtmlAttribute(tag, "id") === "vehicleModal" + id) {
        if (!hasClass(tag, "modal"))
          throw new Error("Army donor modal class changed");
        modals++;
        modalDepth = depth;
        modalStart = match.index + tag.length;
      }
    }
    if (depth < 0) throw new Error("Army donor modal is incomplete");
  }
  if (depth !== 0 || modals !== 1 || modal === null)
    throw new Error("Army donor modal is incomplete or ambiguous");
  const field = (label: string, required: boolean) => {
    const pattern = new RegExp(
      `<div\\b[^>]*>\\s*<span\\b[^>]*>\\s*${label}:\\s*<\\/span>\\s*([^<]*)<\\/div>`,
      "gi",
    );
    const matches = [...modal.matchAll(pattern)];
    if (matches.length > 1 || (required && matches.length !== 1))
      throw new Error(
        "Army donor has missing or duplicate " + label + " fields",
      );
    return text(matches[0]?.[1] ?? "", required ? "required" : "optional");
  };
  return { id, vin: field("VIN", true), stock: field("Stock Number", false) };
}

export function parseArmyCatalog(html: string): ArmyRecord[] {
  const clean = stripInventoryRawText(html);
  if (html.length > 4_000_000 || !/<\/html>\s*$/i.test(clean))
    throw new Error("Army inventory is oversized or truncated");
  verifyScope(clean);
  const scripts = [
    ...html
      .replace(/<!--[\s\S]*?-->/g, "")
      .matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gi),
  ];
  const sources = scripts.map((match) =>
    inventoryHtmlAttribute(match[1] ?? "", "src"),
  );
  if (
    !sources.includes(
      "https://armysauto.com/wp-content/plugins/yswp/assets/yswp.js?ver=0.60",
    ) ||
    !sources.includes(
      "https://cdn.jsdelivr.net/npm/bootstrap-table@1.24.1/dist/bootstrap-table.min.js",
    ) ||
    scripts.some((match) =>
      /bootstrapTable|sidePagination|serverSide/i.test(match[2] ?? ""),
    )
  )
    throw new Error(
      "Army inline inventory script contract changed; recheck complete enumeration",
    );
  const openings = [...clean.matchAll(/<table\b[^>]*>/gi)].filter(([tag]) =>
    hasClass(tag, "bootstrap-tables"),
  );
  const tables = [
    ...clean.matchAll(/(<table\b[^>]*>)([\s\S]*?)<\/table>/gi),
  ].filter((match) => hasClass(match[1] ?? "", "bootstrap-tables"));
  const table = tables[0];
  if (
    openings.length !== 1 ||
    tables.length !== 1 ||
    !table?.[1] ||
    table[2] === undefined
  )
    throw new Error("Expected one complete Army inventory table");
  const attributes = new Map([
    ["data-pagination", "false"],
    ["data-search", "true"],
    ["data-show-toggle", "false"],
    ["data-toolbar", ".toolbar"],
    ["data-use-row-attr-func", "true"],
    ["data-reorderable-rows", "false"],
  ]);
  if (
    [...attributes].some(
      ([key, value]) => inventoryHtmlAttribute(table[1] ?? "", key) !== value,
    ) ||
    [...table[1].matchAll(/\b(data-[\w-]+)(?=\s|=|>)/gi)].some(
      (match) => !attributes.has(match[1]?.toLowerCase() ?? ""),
    )
  )
    throw new Error("Army complete inline pagination mode changed");
  const { head, body } = inventoryTableSections(table[2]);
  const headingRow = /^\s*<tr\b[^>]*>([\s\S]*?)<\/tr>\s*$/i.exec(head)?.[1];
  const headings = [
    ...(headingRow ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi),
  ];
  const labels = ["Images", "Make", "Model", "Year", "Color"];
  if (
    headings.length !== 5 ||
    headings.some((match, index) => text(match[1] ?? "") !== labels[index]) ||
    headingRow?.replace(/<th\b[^>]*>[\s\S]*?<\/th>/gi, "").trim()
  )
    throw new Error("Army inventory headings changed");
  const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (
    rows.length === 0 ||
    rows.length > 10_000 ||
    body.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, "").trim() ||
    rows.some((match) => /<\/?tr\b/i.test(match[1] ?? ""))
  )
    throw new Error("Army inventory rows are empty, incomplete or oversized");
  const ids = new Set<string>();
  return rows.map((match) => {
    const row = match[1] ?? "";
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (
      cells.length !== 5 ||
      row.replace(/<td\b[^>]*>[\s\S]*?<\/td>/gi, "").trim() ||
      cells.some((cell) => /<\/?(?:td|th|tr)\b/i.test(cell[1] ?? ""))
    )
      throw new Error("Army donor cells are incomplete or changed");
    const identity = modalFields(cells[0]?.[1] ?? "");
    if (ids.has(identity.id))
      throw new Error("Army catalog repeated a native donor ID");
    ids.add(identity.id);
    const fields = cells
      .slice(1)
      .map((cell, index) =>
        text(cell[1] ?? "", index === 3 ? "optional" : "required"),
      );
    if (
      [...fields, identity.stock, identity.vin].some(
        (value) => value.length > 300,
      )
    )
      throw new Error("Army donor field exceeds its inspected bound");
    return {
      ...identity,
      make: fields[0] ?? "",
      model: fields[1] ?? "",
      year: fields[2] ?? "",
      color: fields[3] ?? "",
    };
  });
}
