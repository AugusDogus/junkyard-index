import { inventoryHtmlAttribute } from "./inventory-html";
import { prattText } from "./pratt-html";

export const NORTHWEST_ORIGIN = "https://northwestautoparts.com";

/** Preserve literal native punctuation. Do not let URL parsing repair a path. */
function literalReference(raw: string): boolean {
  if (
    !raw ||
    /[\s\\?#]/.test(raw) ||
    [...raw].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return false;
  const absolute = /^(?:https:\/\/|\/\/)([^/]+)(.*)$/i.exec(raw);
  if (absolute?.[1]?.includes("@")) return false;
  const path = absolute ? (absolute[2] ?? "") : raw;
  if (path.includes("//")) return false;
  try {
    return path.split("/").every((part, index, parts) => {
      if (!part) return index === 0 || index === parts.length - 1;
      const decoded = decodeURIComponent(part);
      return /^[a-z0-9_().~+-]+$/i.test(decoded) && /[a-z0-9]/i.test(decoded);
    });
  } catch {
    return false;
  }
}

function owned(url: URL | null): url is URL {
  return (
    url !== null &&
    url.origin === NORTHWEST_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
}

/** The base is an actual source URL, never an arbitrary referring page. */
export function northwestOwnedUrl(
  raw: string,
  base: string = NORTHWEST_ORIGIN,
): URL | null {
  const source = literalReference(base) ? URL.parse(base) : null;
  if (!owned(source) || !literalReference(raw)) return null;
  const url = URL.parse(raw, source);
  return owned(url) ? url : null;
}

/** Validate a published make/model path without deriving any native YMM. */
export function northwestBrowsePath(
  raw: string,
  depth: 1 | 2,
  base: string = NORTHWEST_ORIGIN,
): string | null {
  const url = northwestOwnedUrl(raw, base);
  if (!url) return null;
  const segments = url.pathname.replace(/\/$/, "").split("/");
  return segments.length === depth + 2 &&
    segments[1] === "parts" &&
    segments[2] !== "makes"
    ? url.pathname
    : null;
}

export type NorthwestDocumentLimit = { readonly maximumBytes: number };
export type NorthwestHtmlErrorCode =
  | "invalid-byte-limit"
  | "oversized-document"
  | "malformed-document"
  | "missing-or-conflicting-owner"
  | "missing-physical-binding";
export type NorthwestDocumentResult =
  | { ok: true; value: string }
  | {
      ok: false;
      error: {
        tag: "NorthwestHtmlError";
        code: NorthwestHtmlErrorCode;
        message: string;
      };
    };

function failure(
  code: NorthwestHtmlErrorCode,
  detail: string,
): NorthwestDocumentResult {
  return {
    ok: false,
    error: {
      tag: "NorthwestHtmlError",
      code,
      message: `Northwest HTML: ${detail}. Retain the original response and inspect its source boundary before parsing inventory.`,
    },
  };
}

/** Only literal, unconditional source declarations establish ownership.
 * Strings, comments and templates cannot supply declarations. Other binding
 * syntax, including regex/division in a binding script, fails closed.
 */
function sourceClaims(
  script: string,
): { suppliers: string[]; homes: string[] } | null {
  const tokens: string[] = [];
  const lexical =
    /\/\*[\s\S]*?(?:\*\/|$)|(?:\/\/|<!--)[^\r\n\u2028\u2029]*|"(?:\\[\s\S]|[^"\\\r\n])*"|'(?:\\[\s\S]|[^'\\\r\n])*'|`(?:\\[\s\S]|[^`\\])*`|[a-z_$][\w$]*|[^\s]/gi;
  for (const [token] of script.matchAll(lexical)) {
    if (token.startsWith("/*")) {
      if (!token.endsWith("*/")) return null;
    } else if (!token.startsWith("//") && !token.startsWith("<!--")) {
      if (
        ["'", '"', "`", "/", "\\"].includes(token) ||
        (token.startsWith("`") && token.includes("${"))
      )
        return null;
      tokens.push(token);
    }
  }
  const suppliers: string[] = [],
    homes: string[] = [];
  const nesting: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "urgid" || token === "iisHomeUrl") {
      const literal = tokens[index + 2] ?? "";
      if (
        nesting.length !== 0 ||
        !["var", "let", "const"].includes(tokens[index - 1] ?? "") ||
        (index !== 1 && tokens[index - 2] !== ";") ||
        tokens[index + 1] !== "=" ||
        !/^(['"])[^'"\\\r\n]*\1$/.test(literal) ||
        tokens[index + 3] !== ";"
      )
        return null;
      (token === "urgid" ? suppliers : homes).push(literal.slice(1, -1));
    }
    if (token && ["{", "(", "["].includes(token)) nesting.push(token);
    if (token && ["}", ")", "]"].includes(token)) {
      const expected = token === "}" ? "{" : token === ")" ? "(" : "[";
      if (nesting.pop() !== expected) return null;
    }
  }
  return nesting.length === 0 ? { suppliers, homes } : null;
}

type DocumentParts = { html: string; text: string; scripts: string[] };

/** Decode relevant ASCII references once. Unsupported encodings fail closed. */
function scriptAttributeValue(raw: string): string | null {
  let supported = true;
  const decoded = raw.replace(
    /&(?:#(?:[xX][0-9a-fA-F]+|[0-9]+);?|(?:sol|Tab|NewLine);)/g,
    (reference) => {
      if (reference === "&sol;") return "/";
      if (reference === "&Tab;") return "\t";
      if (reference === "&NewLine;") return "\n";
      const hex = reference[2]?.toLowerCase() === "x";
      const point = Number.parseInt(
        reference.slice(hex ? 3 : 2),
        hex ? 16 : 10,
      );
      if (point < 1 || point > 127) {
        supported = false;
        return reference;
      }
      return String.fromCharCode(point);
    },
  );
  return supported && !decoded.includes("&") ? decoded : null;
}

/** HTML ignores legacy language when type is present, including empty type.
 * Only an absent or literally empty type defaults to JavaScript before trimming.
 */
function javascriptType(tag: string): boolean | null {
  const type = inventoryHtmlAttribute(tag, "type");
  const language = inventoryHtmlAttribute(tag, "language");
  const value = scriptAttributeValue(type ?? language ?? "");
  if (value === null) return null;
  if (value === "") return true;
  const effective = (type !== null ? value : `text/${value}`)
    .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "")
    .toLowerCase();
  return [
    "application/ecmascript",
    "application/javascript",
    "application/x-ecmascript",
    "application/x-javascript",
    "text/ecmascript",
    "text/javascript",
    "text/javascript1.0",
    "text/javascript1.1",
    "text/javascript1.2",
    "text/javascript1.3",
    "text/javascript1.4",
    "text/javascript1.5",
    "text/jscript",
    "text/livescript",
    "text/x-ecmascript",
    "text/x-javascript",
  ].includes(effective);
}

/** Scan in source order so fake frame tags inside attributes/raw text stay inert.
 * This validates the outer document, not donor regions or catalog completeness.
 */
function documentParts(raw: string): DocumentParts | null {
  let frame:
    | "before-html"
    | "before-body"
    | "body"
    | "after-body"
    | "after-html" = "before-html";
  let index = 0,
    doctype = false;
  const html: string[] = [],
    text: string[] = [],
    scripts: string[] = [];
  const hiddenElements: string[] = [];
  const svgElements: string[] = [];
  let hiddenRoot = false;
  while (index < raw.length) {
    const next = raw.indexOf("<", index);
    const end = next === -1 ? raw.length : next;
    const content = raw.slice(index, end);
    if (frame !== "body" && content.trim()) return null;
    if (svgElements.length && content.trim()) return null;
    html.push(content);
    if (frame === "body" && !hiddenRoot && !hiddenElements.length)
      text.push(content);
    index = end;
    if (index === raw.length) break;
    if (raw.startsWith("<!--", index)) {
      if (raw.startsWith("<!-->", index) || raw.startsWith("<!--->", index))
        return null;
      const close = raw.indexOf("-->", index + 4);
      if (close === -1 || raw.slice(index + 4, close).includes("--!>"))
        return null;
      index = close + 3;
      html.push(" ");
      continue;
    }
    const declaration = /^<!doctype[\t\n\f\r ]+html[\t\n\f\r ]*>/i.exec(
      raw.slice(index),
    );
    if (declaration) {
      if (frame !== "before-html" || doctype) return null;
      doctype = true;
      html.push(declaration[0]);
      index += declaration[0].length;
      continue;
    }
    const match =
      /^<(\/?)([a-z][\w:-]*)(?=[\t\n\f\r />])(?:[^<>"']|"[^"]*"|'[^']*')*>/i.exec(
        raw.slice(index),
      );
    if (!match) return null;
    const tag = match[0],
      name = match[2]?.toLowerCase();
    const closing = match[1] === "/";
    if (closing && !/^<\/[a-z][\w:-]*[\t\n\f\r ]*>$/i.test(tag)) return null;
    // Bound the shared helper to exact names and HTML ASCII separators. Quotes
    // only delimit values after '='; unsupported unquoted syntax fails closed.
    const opening = closing
      ? null
      : /^<[a-z][\w:-]*(?:[\t\n\f\r ]+[a-z_:][a-z0-9_.:-]*(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"[^"]*"|'[^']*'|[^\s"'`=<>]+))?)*[\t\n\f\r ]*(\/?)>$/i.exec(
          tag,
        );
    if (!closing && !opening) return null;
    index += tag.length;
    // Only inert svg/g/path icon markup is supported. Reject other foreign
    // elements before applying HTML script attributes or raw-text semantics.
    if (name === "svg" || svgElements.length) {
      if (frame !== "body" || !name || !["svg", "g", "path"].includes(name))
        return null;
      if (closing) {
        if (svgElements.pop() !== name) return null;
      } else {
        if (name === "svg" && svgElements.length) return null;
        // Greedy unquoted values consume their slash. Only the delimiter
        // captured outside a value closes a foreign element.
        if (opening?.[1] !== "/") svgElements.push(name);
      }
      html.push(tag);
      continue;
    }
    if (name === "html" || name === "body") {
      if (/\/\s*>$/.test(tag)) return null;
      if (!closing && inventoryHtmlAttribute(tag, "hidden") !== null)
        hiddenRoot = true;
      if (name === "html" && !closing && frame === "before-html")
        frame = "before-body";
      else if (name === "body" && !closing && frame === "before-body")
        frame = "body";
      else if (name === "body" && closing && frame === "body")
        frame = "after-body";
      else if (name === "html" && closing && frame === "after-body")
        frame = "after-html";
      else return null;
    } else if (frame !== "before-body" && frame !== "body") return null;
    // Native originals do not require base overrides, inert template/plaintext
    // regions or MathML. Reject them rather than infer script execution.
    if (
      name === "base" ||
      name === "plaintext" ||
      name === "template" ||
      name === "math"
    )
      return null;
    if (
      name &&
      /^(?:script|style|title|textarea|iframe|xmp|noembed|noframes|noscript)$/.test(
        name,
      )
    ) {
      if (closing || /\/\s*>$/.test(tag)) return null;
      const close = new RegExp(`</${name}[\\t\\n\\f\\r ]*>`, "gi");
      close.lastIndex = index;
      const last = close.exec(raw);
      if (!last) return null;
      if (name === "script") {
        const content = raw.slice(index, last.index);
        // This source contract does not support HTML script double-escaping.
        if (/<!--[\s\S]*?<script(?=[\t\n\f\r />])/i.test(content)) return null;
        if (
          inventoryHtmlAttribute(tag, "src") === null &&
          inventoryHtmlAttribute(tag, "nomodule") === null
        ) {
          const javascript = javascriptType(tag);
          if (javascript === null) return null;
          if (javascript) scripts.push(content);
        }
      }
      index = last.index + last[0].length;
      html.push(" ");
    } else {
      if (frame === "body" && name !== "body" && name) {
        if (closing) {
          if (hiddenElements.length && hiddenElements.pop() !== name)
            return null;
        } else if (
          !/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(
            name,
          ) &&
          (hiddenElements.length ||
            inventoryHtmlAttribute(tag, "hidden") !== null)
        )
          hiddenElements.push(name);
      }
      html.push(tag);
    }
    if (frame === "body") text.push(" ");
  }
  return frame === "after-html" && !hiddenElements.length && !svgElements.length
    ? { html: html.join(""), text: prattText(text.join("")), scripts }
    : null;
}

/** Pure content ownership check. The caller supplies its independently chosen
 * byte allocation. Success does not establish transport, donor scope or a census.
 */
export function northwestDocument(
  raw: string,
  limit: NorthwestDocumentLimit,
): NorthwestDocumentResult {
  if (!Number.isSafeInteger(limit.maximumBytes) || limit.maximumBytes <= 0)
    return failure(
      "invalid-byte-limit",
      "maximumBytes must be an explicit positive safe integer",
    );
  if (Buffer.byteLength(raw) > limit.maximumBytes)
    return failure(
      "oversized-document",
      `response exceeds the caller's ${limit.maximumBytes}-byte allocation`,
    );
  let parts: DocumentParts | null;
  try {
    parts = raw.includes("\u0000") ? null : documentParts(raw);
  } catch {
    // inventoryHtmlAttribute rejects duplicate attributes. Keep malformed input a value.
    return failure(
      "malformed-document",
      "ambiguous document attributes prevent ownership validation",
    );
  }
  if (!parts)
    return failure(
      "malformed-document",
      "expected one complete html/body frame with supported script attributes and closed comments and raw-text elements",
    );
  const suppliers: string[] = [],
    homes: string[] = [];
  for (const script of parts.scripts) {
    // Detect escaped references before the strict lexer rejects their syntax.
    // This is only a reference check, never a way to supply an owner claim.
    const references = script.replace(
      /\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})/gi,
      (
        literal: string,
        braced: string | undefined,
        fixed: string | undefined,
      ) => {
        const point = Number.parseInt(braced ?? fixed ?? "", 16);
        return point <= 127 ? String.fromCharCode(point) : literal;
      },
    );
    if (!/\b(?:urgid|iisHomeUrl)\b/.test(references)) continue;
    const claims = sourceClaims(script);
    if (!claims)
      return failure(
        "missing-or-conflicting-owner",
        "source bindings must be unconditional literal declarations",
      );
    suppliers.push(...claims.suppliers);
    homes.push(...claims.homes);
  }
  if (
    !suppliers.length ||
    suppliers.some((supplier) => supplier !== "AK01") ||
    !homes.length ||
    homes.some(
      (home) =>
        ![
          "northwestautoparts.com",
          NORTHWEST_ORIGIN,
          NORTHWEST_ORIGIN + "/",
        ].includes(home),
    )
  )
    return failure(
      "missing-or-conflicting-owner",
      "AK01 supplier and native home declarations are missing or conflicting",
    );
  if (
    ![
      /\bNorthwest Auto Parts\b/,
      /\b5700 Camelot Drive\b/,
      /\bAnchorage, AK 99504\b/,
      /\b907-333-6531\b/,
    ].every((claim) => claim.test(parts.text))
  )
    return failure(
      "missing-physical-binding",
      "visible Northwest name, Anchorage address or phone is missing",
    );
  return { ok: true, value: parts.html };
}
