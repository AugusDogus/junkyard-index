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

describe("SearchServerRender.decide", () => {
  test.each([PERSON, IPHONE, CUBOT_WEBVIEW])(
    "searches on the server for a person's specific search",
    (userAgent) => {
      expect(
        SearchServerRender.decide({
          userAgent,
          params: { q: "Toyota Venza", minYear: "2011" },
        }),
      ).toBe("search");
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
  ])("skips the server search for %s", (userAgent) => {
    expect(
      SearchServerRender.decide({ userAgent, params: { q: "Toyota" } }),
    ).toBe("skip");
  });

  test("skips the server search without a user agent", () => {
    expect(
      SearchServerRender.decide({ userAgent: null, params: { q: "Toyota" } }),
    ).toBe("skip");
  });

  test.each([
    {},
    { utm_source: "newsletter", utm_campaign: "launch" },
    { gclid: "abc" },
    { subscription: "success" },
    { q: undefined },
  ])("skips the server search for the default page %p", (params) => {
    expect(SearchServerRender.decide({ userAgent: PERSON, params })).toBe(
      "skip",
    );
  });

  test.each([
    { q: "" },
    { sort: "oldest" },
    { "makes[]": ["Toyota"] },
    { yardTypes: "all" },
    { q: "Civic", utm_source: "newsletter" },
  ])("searches on the server when the URL asks for %p", (params) => {
    expect(SearchServerRender.decide({ userAgent: PERSON, params })).toBe(
      "search",
    );
  });
});
