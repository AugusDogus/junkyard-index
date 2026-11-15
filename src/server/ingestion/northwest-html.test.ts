import { expect, test } from "bun:test";
import {
  NORTHWEST_ORIGIN,
  northwestBrowsePath,
  northwestDocument,
  northwestOwnedUrl,
  type NorthwestHtmlErrorCode,
} from "./northwest-html";

// Synthetic boundary fixture with source-observed declarations and contact facts.
// This is not a raw HTTP response or a donor-model fixture.
const binding = `var iisHomeUrl = 'northwestautoparts.com';
var urgid = 'AK01';`;
const contact = `<footer>Northwest Auto Parts
5700 Camelot Drive<br>Anchorage, AK 99504<br>907-333-6531</footer>`;
const synthetic = `<!DOCTYPE html><html><head>
<script type="text/javascript">${binding}</script>
</head><body>${contact}</body></html>`;

function check(raw: string) {
  return northwestDocument(raw, { maximumBytes: Buffer.byteLength(raw) + 1 });
}

function rejected(raw: string, code: NorthwestHtmlErrorCode) {
  const result = check(raw);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.tag).toBe("NorthwestHtmlError");
    expect(result.error.code).toBe(code);
  }
}

test("accepts a complete synthetic AK01 owner document without a canonical link", () => {
  const result = northwestDocument(synthetic, {
    maximumBytes: Buffer.byteLength(synthetic),
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toContain(contact);
    expect(result.value).not.toContain("<script");
  }
});

test("accepts repeated agreeing declarations and a trailing complete comment", () => {
  const raw = synthetic.replace(
    "</body>",
    `<script>${binding}</script></body>`,
  );
  const result = check(raw + "<!-- synthetic cache footer -->");
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).not.toContain("cache footer");
});

test.each([
  binding.replace("AK01", "AR18"),
  binding.replace("northwestautoparts.com", "foreign.example"),
  binding.replace("northwestautoparts.com", "www.northwestautoparts.com"),
  binding.replace(
    "northwestautoparts.com",
    "https://northwestautoparts.com/parts/",
  ),
  `${binding}\nvar urgid = 'AR18';`,
  `${binding}\nvar iisHomeUrl = 'foreign.example';`,
  `var urgid = 'AK01';`,
  `var iisHomeUrl = 'northwestautoparts.com';`,
  `var urgid = 'AK01' + 'AR18'; var iisHomeUrl = 'northwestautoparts.com';`,
  `var urgid = 'AK01', iisHomeUrl = 'northwestautoparts.com';`,
  `if (false) { ${binding} }`,
  `function unused() { ${binding} }`,
  `${binding}\nurgid = 'AR18';`,
  `${binding}\nlet iisHomeUrl;`,
  `${binding}\n/* unclosed comment`,
  `${binding}\nvar broken = 'unclosed`,
  `${binding}\n}`,
  `${binding}\nfunction unclosed() {`,
  `${binding}\nwindow.test([)];`,
])(
  "rejects missing, conflicting or unsupported binding declarations: %s",
  (claims) => {
    rejected(
      synthetic.replace(binding, claims),
      "missing-or-conflicting-owner",
    );
  },
);

test.each([
  `<!-- <script>${binding}</script> -->`,
  `<script src="https://foreign.example/config.js">${binding}</script>`,
  `<script src="/config.js">${binding}</script>`,
  `<script type="application/ld+json">${binding}</script>`,
  `<script type="text/plain">${binding}</script>`,
  `<div>${binding}</div>`,
  `<div data-config="${binding}">placeholder</div>`,
  `<script>/* ${binding} */</script>`,
  `<script>// var urgid = 'AK01';\n// var iisHomeUrl = 'northwestautoparts.com';</script>`,
  `<script>var example = ${JSON.stringify(binding)};</script>`,
  `<script>var example = \`${binding}\`;</script>`,
  `<script>var example = /var urgid = 'AK01'; var iisHomeUrl = 'northwestautoparts.com';/;</script>`,
  `<textarea><script>${binding}</script></textarea>`,
  `<iframe><script>${binding}</script></iframe>`,
  `<noscript><script>${binding}</script></noscript>`,
])(
  "inert or external declarations cannot establish ownership: %s",
  (replacement) => {
    const raw = synthetic
      .replace(`<script type="text/javascript">${binding}</script>`, "")
      .replace("<body>", `<body>${replacement}`);
    rejected(raw, "missing-or-conflicting-owner");
  },
);

test("commented or quoted conflicts are not actual declarations", () => {
  const extra = `\n/* var urgid = 'FOREIGN'; */
// var iisHomeUrl = 'foreign.example';
var example = "var urgid = 'FOREIGN';";`;
  expect(check(synthetic.replace(binding, binding + extra)).ok).toBe(true);
  expect(
    check(synthetic.replace(binding, `/* source comment */ ${binding}`)).ok,
  ).toBe(true);
});

test.each([
  "// note\u2028var urgid = 'AR18';",
  "// note\u2029var urgid = 'AR18';",
  "<!-- note\u2028var urgid = 'AR18';",
  'var example = `${urgid = "AR18"}`;',
  String.raw`var ur\u0067id = 'AR18';`,
  String.raw`var iisHome\u0055rl = 'foreign.example';`,
])("unsupported active binding syntax cannot hide a conflict: %s", (extra) => {
  rejected(
    synthetic.replace(binding, `${binding}\n${extra}`),
    "missing-or-conflicting-owner",
  );
  rejected(
    synthetic.replace("</head>", `<script>${extra}</script></head>`),
    "missing-or-conflicting-owner",
  );
});

test.each(["nomodule", 'language="VBScript"'])(
  "conditional or non-JavaScript declarations cannot prove ownership: %s",
  (attribute) => {
    rejected(
      synthetic.replace('type="text/javascript"', attribute),
      "missing-or-conflicting-owner",
    );
  },
);

test.each([
  'type="text/javascript" language="VBScript"',
  'type="application/javascript" language="JavaScript1.2"',
  'type="" language="VBScript"',
  'type=" text/javascript " language="VBScript"',
  'type="text/ecmascript" language="VBScript"',
  'language="JavaScript1.2"',
  'type="text&#47;javascript"',
  'type="text&#47javascript"',
  'type="text&#x2f;javascript"',
  'type="text&sol;javascript"',
  'type="&#32;text/javascript&#32;"',
  'type="&Tab;text/javascript&NewLine;"',
  'language="Java&#83;cript"',
])("active JavaScript ownership honors effective type: %s", (attributes) => {
  expect(
    check(synthetic.replace('type="text/javascript"', attributes)).ok,
  ).toBe(true);
  for (const conflict of [
    "var urgid = 'AR18';",
    "var iisHomeUrl = 'foreign.example';",
  ]) {
    rejected(
      synthetic.replace(
        "</head>",
        `<script ${attributes}>${conflict}</script></head>`,
      ),
      "missing-or-conflicting-owner",
    );
  }
});

test.each(['type=" "', 'type="\t\n\f\r "', 'type="&#32;"'])(
  "whitespace-only type remains inert: %s",
  (attributes) => {
    rejected(
      synthetic.replace('type="text/javascript"', attributes),
      "missing-or-conflicting-owner",
    );
    expect(
      check(
        synthetic.replace(
          "</head>",
          `<script ${attributes}>var urgid = 'AR18';</script></head>`,
        ),
      ).ok,
    ).toBe(true);
  },
);

test.each(['type="&unknown;"', 'language="Java&unknown;Script"'])(
  "unsupported attribute encodings reject the document: %s",
  (attributes) => {
    rejected(
      synthetic.replace(
        "</head>",
        `<script ${attributes}>var urgid = 'AR18';</script></head>`,
      ),
      "malformed-document",
    );
  },
);

test("explicit JavaScript type ignores encoded legacy language", () => {
  expect(
    check(
      synthetic.replace(
        'type="text/javascript"',
        'type="text/javascript" language="&unknown;"',
      ),
    ).ok,
  ).toBe(true);
});

test.each([
  synthetic.replace(
    "<body>",
    "<body><!--><script>var urgid = 'AR18';</script>-->",
  ),
  synthetic + "<!--></body></html>-->",
  synthetic.replace("</head>", "<script><!--<script></script></head>"),
])("unsupported comment and script states cannot fake a frame (%#)", (raw) => {
  rejected(raw, "malformed-document");
});

test.each([
  `<script href="/external.js">${binding}</script>`,
  `<script xlink:href="/external.js">${binding}</script>`,
  `<script src="/unused.js">var urgid = 'AR18';</script>`,
  `<script nomodule>var urgid = 'AR18';</script>`,
  `<script language="VBScript">var urgid = 'AR18';</script>`,
  `<title><script>var urgid = 'AR18';</script></title>`,
  `<desc><script>var urgid = 'AR18';</script></desc>`,
  `<foreignObject><script>var urgid = 'AR18';</script></foreignObject>`,
])(
  "unsupported SVG contexts cannot establish or hide owner claims: %s",
  (content) => {
    rejected(
      synthetic.replace("<body>", `<body><svg>${content}</svg>`),
      "malformed-document",
    );
  },
);

test.each([
  `<svg viewBox="0 0 16 16"><g><path d="M0,0 L1,1"></path></g></svg>`,
  `<svg><path d="M0,0 L1,1" /></svg>`,
])(
  "supports inert SVG path icons without supplying owner or contact claims: %s",
  (icon) => {
    expect(check(synthetic.replace("<body>", `<body>${icon}`)).ok).toBe(true);
  },
);

test("hidden contact cannot supply physical binding while visible contact survives", () => {
  rejected(
    synthetic.replace(
      contact,
      `<div hidden><section>${contact}</section></div>`,
    ),
    "missing-physical-binding",
  );
  rejected(
    synthetic.replace("<body>", "<body hidden>"),
    "missing-physical-binding",
  );
  expect(
    check(
      synthetic.replace(
        "<body>",
        "<body><div hidden>unrelated</div><input hidden>",
      ),
    ).ok,
  ).toBe(true);
});

test("ignores foreign script claims when actual inline source claims agree", () => {
  const raw = synthetic.replace(
    "</head>",
    `<script src="https://foreign.example/config.js">var urgid = 'AR18';</script></head>`,
  );
  expect(check(raw).ok).toBe(true);
});

test.each([
  synthetic.slice(0, synthetic.indexOf("</body>")),
  synthetic.replace("<html>", ""),
  synthetic.replace("<body>", ""),
  synthetic.replace("</body>", ""),
  synthetic.replace("</html>", ""),
  synthetic.replace("<html>", "<html><html>"),
  synthetic.replace("<body>", "<body><body>"),
  synthetic.replace("</body></html>", "</html></body>"),
  synthetic.replace("<body>", "<body/>"),
  synthetic + synthetic,
  synthetic + "truncated tail",
  synthetic + "<!-- unclosed comment",
  synthetic.replace("</script>", ""),
  synthetic.replace("</head>", "<style>unclosed</head>"),
  synthetic.replace("</head>", "</style></head>"),
  synthetic.replace("</body>", "<textarea>unclosed</body>"),
  synthetic.replace("</body>", "<iframe>unclosed</body>"),
  `<script>var example = ${JSON.stringify(synthetic)};</script>`,
  `<!-- ${synthetic} -->`,
  synthetic.replace("<html>", `<div data-frame="<html>">`),
  synthetic.replace("<body>", `<div data-frame="<body>">`),
  synthetic.replace("<body>", `<body broken="unterminated>`),
  synthetic.replace("<body>", `<body>\u0000`),
  synthetic.replace("</head>", `<base href="https://foreign.example/"></head>`),
  synthetic.replace(
    "</body>",
    `<template><template></template></template></body>`,
  ),
  synthetic.replace(
    'type="text/javascript"',
    `type="text/javascript" type="text/plain"`,
  ),
  synthetic.replace(
    'type="text/javascript"',
    `src="https://foreign.example/a" src="/local"`,
  ),
])("rejects malformed or fake document frames without throwing (%#)", (raw) => {
  rejected(raw, "malformed-document");
});

test("fake frame tags in closed comments, raw text or attributes are inert", () => {
  const extra = `<!-- <html><body></body></html> -->
<script>var example = '<html><body></body></html>';</script>
<style>/* <html><body></body></html> */</style>
<textarea><html><body></body></html></textarea>
<div data-frame="<html><body></body></html>"></div>`;
  expect(check(synthetic.replace("</body>", extra + "</body>")).ok).toBe(true);
});

test.each([
  "Northwest Auto Parts",
  "5700 Camelot Drive",
  "Anchorage, AK 99504",
  "907-333-6531",
])("requires visible physical binding: %s", (claim) => {
  rejected(synthetic.replace(claim, "unrelated"), "missing-physical-binding");
  rejected(
    synthetic.replace(contact, `<!-- ${contact} -->`),
    "missing-physical-binding",
  );
  rejected(
    synthetic.replace(
      contact,
      `<script>var text = ${JSON.stringify(contact)};</script>`,
    ),
    "missing-physical-binding",
  );
  rejected(
    synthetic.replace(contact, `<textarea>${contact}</textarea>`),
    "missing-physical-binding",
  );
});

test("uses UTF-8 bytes and a caller-supplied positive allocation", () => {
  const raw = synthetic.replace("</body>", "é</body>");
  expect(
    northwestDocument(raw, { maximumBytes: Buffer.byteLength(raw) }).ok,
  ).toBe(true);
  const oversized = northwestDocument(raw, { maximumBytes: raw.length });
  expect(oversized.ok).toBe(false);
  if (!oversized.ok) expect(oversized.error.code).toBe("oversized-document");
  for (const maximumBytes of [
    0,
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const result = northwestDocument(raw, { maximumBytes });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid-byte-limit");
  }
});

test("resolves native literal hrefs against a validated actual source base", () => {
  const base = NORTHWEST_ORIGIN + "/parts/ACURA/";
  expect(northwestOwnedUrl("RDX/", base)?.href).toBe(
    NORTHWEST_ORIGIN + "/parts/ACURA/RDX/",
  );
  expect(
    northwestOwnedUrl(
      "//northwestautoparts.com/parts/ACURA/RDX/Q367/2010",
      base,
    )?.href,
  ).toBe(NORTHWEST_ORIGIN + "/parts/ACURA/RDX/Q367/2010");
  expect(northwestOwnedUrl("/search-inventory/")?.pathname).toBe(
    "/search-inventory/",
  );
  expect(northwestOwnedUrl("/")?.href).toBe(NORTHWEST_ORIGIN + "/");
});

test.each([
  "https://foreign.example/parts/ACURA/RDX/",
  "https://www.northwestautoparts.com/parts/ACURA/RDX/",
  "http://northwestautoparts.com/parts/ACURA/RDX/",
  "https://northwestautoparts.com:8443/parts/ACURA/RDX/",
  "https://user@northwestautoparts.com/parts/ACURA/",
  "https://@northwestautoparts.com/parts/ACURA/",
  "https://northwestautoparts.com@foreign.example/parts/ACURA/",
  "//foreign.example/parts/ACURA/",
  "/parts/ACURA/?page=2",
  "/parts/ACURA/?",
  "/parts/ACURA/#model",
  "/parts/ACURA/#",
  " /parts/ACURA/",
  "/parts/ACURA/\n",
  "/parts\\ACURA/",
  "https:northwestautoparts.com/parts/ACURA/",
  "/parts//ACURA/",
  "/parts/../ACURA/",
  "/parts/./ACURA/",
  "/parts/%2e%2e/ACURA/",
  "/parts/ACURA%2fRDX/",
  "/parts/ACURA%5cRDX/",
  "/parts/%00/",
  "/parts/%ff/",
  "/parts/%zz/",
  "/parts/ACURA/%252e%252e/",
  "",
  "javascript:alert(1)",
])("rejects unowned or repaired URL input: %s", (raw) => {
  expect(northwestOwnedUrl(raw)).toBeNull();
});

test.each([
  "https://foreign.example/parts/ACURA/",
  "https://www.northwestautoparts.com/parts/ACURA/",
  "https://user@northwestautoparts.com/parts/ACURA/",
  "https://@northwestautoparts.com/parts/ACURA/",
  NORTHWEST_ORIGIN + "/parts/ACURA/?page=1",
  NORTHWEST_ORIGIN + "/parts/../ACURA/",
  "/parts/ACURA/",
  "//northwestautoparts.com/parts/ACURA/",
])("foreign or relative context cannot supply a valid base: %s", (base) => {
  expect(northwestOwnedUrl("RDX/", base)).toBeNull();
  expect(
    northwestOwnedUrl(NORTHWEST_ORIGIN + "/parts/ACURA/RDX/", base),
  ).toBeNull();
});

test.each([
  "/parts/CHEVROLET/BLAZER.JIMMY_(FULL_SIZE)/",
  "/parts/CHEVROLET/CHEVROLET_PASS./",
  "/parts/CHRYSLER/TOWN_-and_COUNTRY/",
  "/parts/FORD/C~MAX/",
  "/parts/ACURA/RDX/",
  "/parts/VOLVO/VOLVO_60_SERIES/",
])(
  "preserves source-observed browse punctuation and trailing slash: %s",
  (path) => {
    expect(northwestBrowsePath(path, 2)).toBe(path);
    expect(northwestBrowsePath(path.slice(0, -1), 2)).toBe(path.slice(0, -1));
    expect(northwestBrowsePath(path, 1)).toBeNull();
  },
);

test("browse depth excludes directory roots and donor/component paths", () => {
  expect(northwestBrowsePath("/parts/ACURA/", 1)).toBe("/parts/ACURA/");
  expect(
    northwestBrowsePath("RDX/", 2, NORTHWEST_ORIGIN + "/parts/ACURA/"),
  ).toBe("/parts/ACURA/RDX/");
  for (const path of [
    "/parts/makes/",
    "/parts/makes/ACURA/",
    "/parts/",
    "/PARTS/ACURA/",
    "/other/ACURA/",
    "/parts/ACURA/RDX/Q367/2010",
  ]) {
    expect(northwestBrowsePath(path, 1)).toBeNull();
    expect(northwestBrowsePath(path, 2)).toBeNull();
  }
});

test.each(["\u00a0", "\u000b", "\u2003", "\ufeff"])(
  "unsupported tag whitespace cannot hide active conflicts: %j",
  (space) => {
    for (const attribute of ['src="/config.js"', "nomodule"]) {
      const raw = synthetic.replace(
        "</head>",
        `<script ${space}${attribute}>var urgid = 'AR18';</script></head>`,
      );
      rejected(raw, "malformed-document");
    }
  },
);

test.each(["\u00a0", "\u000b", "\u2003", "\ufeff"])(
  "non-script tag names cannot establish ownership: %j",
  (space) => {
    const raw = synthetic
      .replace('<script type="text/javascript">', `<script${space}>`)
      .replace("</script>", `</script${space}>`);
    rejected(raw, "malformed-document");
  },
);

test.each(["\t", "\n", "\f", "\r", " "])(
  "HTML ASCII tag whitespace preserves an active owner: %j",
  (space) => {
    const raw = synthetic
      .replace(
        '<script type="text/javascript">',
        `<script${space}type="text/javascript">`,
      )
      .replace("</script>", `</script${space}>`);
    expect(check(raw).ok).toBe(true);
  },
);

test.each([
  'a=x"\u00a0src=x"',
  "a=x'\u000btype=text/plain'",
  "a=0 =src",
  "a=0 =nomodule",
  'a=0 =type="text/plain"',
  'a=0 =language="VBScript"',
])(
  "unsupported attribute syntax cannot hide active conflicts: %s",
  (attributes) => {
    rejected(
      synthetic.replace(
        "</head>",
        `<script ${attributes}>var urgid = 'AR18';</script></head>`,
      ),
      "malformed-document",
    );
  },
);

test.each([
  "<script>" + binding + "</script>",
  "<mrow><script>" + binding + "</script></mrow>",
])("unsupported MathML cannot establish ownership: %s", (content) => {
  const raw = synthetic
    .replace(`<script type="text/javascript">${binding}</script>`, "")
    .replace("<body>", `<body><math>${content}</math>`);
  rejected(raw, "malformed-document");
});

test.each(["a=x/>", "a=x/ >", "a=x/\t>", "a=/>", "a=x//>"])(
  "an unquoted value slash keeps SVG open: %s",
  (attributes) => {
    for (const content of [
      `<script src=x>var urgid = 'AR18';</script>`,
      `<script nomodule>var urgid = 'AR18';</script>`,
      `<title><script>var urgid = 'AR18';</script></title>`,
    ]) {
      rejected(
        synthetic.replace("</body>", `<svg ${attributes}${content}</body>`),
        "malformed-document",
      );
    }
    rejected(
      `<html><body>${contact}<svg ${attributes}<script href=x>${binding}</script></body></html>`,
      "malformed-document",
    );
  },
);

test.each(["<svg/>", "<svg a=x />", '<svg a="x"/>', "<svg a='x'/>"])(
  "recognizes an SVG self-closing delimiter outside values: %s",
  (icon) => {
    expect(check(synthetic.replace("<body>", `<body>${icon}`)).ok).toBe(true);
  },
);

test("an SVG unquoted slash value permits an explicit matching close", () => {
  expect(check(synthetic.replace("<body>", "<body><svg a=x/></svg>")).ok).toBe(
    true,
  );
});
