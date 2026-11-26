import { describe, expect, test } from "bun:test";
import { SearchServerRender } from "./search-server-render";

const PERSON =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
// Android WebView (in-app browsers) still sends the device model, and the
// Cubot brand ends in "bot".
const CUBOT_WEBVIEW =
  "Mozilla/5.0 (Linux; Android 10; CUBOT X30 Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36";
// Some Cubot models join the brand to the model with "_" or "/".
const CUBOT_UNDERSCORE =
  "Mozilla/5.0 (Linux; Android 12; CUBOT_X50 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36";
const CUBOT_SLASH =
  "Mozilla/5.0 (Linux; Android 9; CUBOT/P30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36";

// Production user agents from the Nov 26, 2026 scraper fleet: browser
// strings, no cookies, no scripts run (Vercel Web Analytics counted none of
// their page views).
const SCRAPER_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const SCRAPER_FIREFOX =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:156.0) Gecko/20100101 Firefox/156.0";

describe("SearchServerRender.decide", () => {
  test.each([PERSON, IPHONE, CUBOT_WEBVIEW, CUBOT_UNDERSCORE, CUBOT_SLASH])(
    "searches on the server for a signed-in person's specific search",
    (userAgent) => {
      expect(
        SearchServerRender.decide({
          userAgent,
          visitor: "signed-in",
          params: { q: "Toyota Venza", minYear: "2011" },
        }),
      ).toBe("search");
    },
  );

  // A guest's search runs once from the browser instead, so a client that
  // sends a browser's user agent but runs no scripts spends nothing.
  test.each([
    [PERSON, { q: "Toyota Venza", minYear: "2011" }],
    [IPHONE, { q: "Toyota Venza" }],
    // A yard page's "new this week" link.
    [
      SCRAPER_CHROME,
      {
        "yards[]": "Pick Your Part - Sun Valley",
        "sources[]": "pyp",
        yardTypes: "all",
        "arrivalWindow[]": "7d",
      },
    ],
    // A yard make page's "new this week" link.
    [
      SCRAPER_FIREFOX,
      {
        q: "Kia",
        "yards[]": "Pull N Save - Glendale",
        "sources[]": "pullnsave",
        yardTypes: "all",
        "arrivalWindow[]": "7d",
      },
    ],
    // A model page's search link.
    [SCRAPER_CHROME, { q: "Cadillac CTS" }],
  ])(
    "skips the server search for a guest's specific search %#",
    (userAgent, params) => {
      expect(
        SearchServerRender.decide({ userAgent, visitor: "guest", params }),
      ).toBe("skip");
    },
  );

  test.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Twitterbot/1.0",
    "WhatsApp/2.23.20.0",
    "curl/8.5.0",
    "python-requests/2.32.3",
    "GPTBot/1.2 (+https://openai.com/gptbot)",
  ])("treats %s as a crawler", (userAgent) => {
    expect(
      SearchServerRender.decide({
        userAgent,
        visitor: "guest",
        params: { q: "Toyota" },
      }),
    ).toBe("crawler");
  });

  // Seen in production logs or common monitors; each one that searched on
  // the server spent a request no person saw.
  test.each([
    "Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)",
    "Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)",
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36",
    "python-httpx/0.27.0",
    "Python-urllib/3.12",
    "Scrapy/2.11.2 (+https://scrapy.org)",
    "okhttp/4.12.0",
    "Java/17.0.10",
  ])("treats %s as a crawler", (userAgent) => {
    expect(
      SearchServerRender.decide({
        userAgent,
        visitor: "guest",
        params: { q: "Toyota" },
      }),
    ).toBe("crawler");
  });

  // A session cookie is no proof of a person: the user agent decides first.
  test("treats a signed-in crawler as a crawler", () => {
    expect(
      SearchServerRender.decide({
        userAgent:
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        visitor: "signed-in",
        params: { q: "Toyota" },
      }),
    ).toBe("crawler");
  });

  test.each([null, "", "   "])(
    "treats a client without a user agent as a crawler (%p)",
    (userAgent) => {
      expect(
        SearchServerRender.decide({
          userAgent,
          visitor: "guest",
          params: { q: "Toyota" },
        }),
      ).toBe("crawler");
    },
  );

  // A crawler never searches, even where a person would search from the
  // browser after hydration.
  test.each([{}, { sort: "distance" }, { q: "Civic", radius: "50" }])(
    "treats a crawler on a page a person would skip as a crawler %p",
    (params) => {
      expect(
        SearchServerRender.decide({
          userAgent:
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
          visitor: "guest",
          params,
        }),
      ).toBe("crawler");
    },
  );

  // The browser's stored or account location decides these results, and the
  // server cannot see it, so a server search would be thrown away.
  test.each([
    { sort: "distance" },
    { q: "Civic", radius: "50" },
    { sort: "distance", lat: "33.448", lng: "-112.074" },
  ])(
    "skips the server search for a nearby search without a URL origin %p",
    (params) => {
      expect(
        SearchServerRender.decide({
          userAgent: PERSON,
          visitor: "signed-in",
          params,
        }),
      ).toBe("skip");
    },
  );

  test("searches on the server for a signed-in nearby search with its origin in the URL", () => {
    expect(
      SearchServerRender.decide({
        userAgent: PERSON,
        visitor: "signed-in",
        params: { q: "Civic", lat: "33.448", lng: "-112.074", radius: "50" },
      }),
    ).toBe("search");
  });

  test.each([
    {},
    { utm_source: "newsletter", utm_campaign: "launch" },
    { gclid: "abc" },
    { subscription: "success" },
    { q: undefined },
  ])("skips the server search for the default page %p", (params) => {
    expect(
      SearchServerRender.decide({
        userAgent: PERSON,
        visitor: "signed-in",
        params,
      }),
    ).toBe("skip");
  });

  test.each([
    { q: "" },
    { sort: "oldest" },
    { "makes[]": ["Toyota"] },
    { yardTypes: "all" },
    { q: "Civic", utm_source: "newsletter" },
  ])(
    "searches on the server when a signed-in person's URL asks for %p",
    (params) => {
      expect(
        SearchServerRender.decide({
          userAgent: PERSON,
          visitor: "signed-in",
          params,
        }),
      ).toBe("search");
    },
  );
});
