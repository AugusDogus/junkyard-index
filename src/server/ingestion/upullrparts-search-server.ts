/**
 * Source of the search server that runs inside the U Pull R Parts Vercel
 * Sandbox. getVehicles needs a fresh Cloudflare Turnstile token per request,
 * and only a headed Chromium (under Xvfb) that clicks the widget receives one.
 * The server keeps a few inventory tabs open and answers authenticated
 * `POST /search` requests with the raw getVehicles rows.
 */
export const UPULLRPARTS_SEARCH_SERVER_SOURCE = String.raw`
import http from "node:http";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT ?? 3000);
const AUTH = process.env.SEARCH_AUTH_TOKEN ?? "";
const WORKERS = Number(process.env.SEARCH_WORKERS ?? 6);
const INVENTORY_URL = "https://upullrparts.com/inventory/";
// Turnstile escalates after two tokens on one page load.
const TOKENS_PER_LOAD = 2;

if (AUTH.length < 32) {
  console.error("SEARCH_AUTH_TOKEN must be at least 32 characters");
  process.exit(1);
}

const browser = await chromium.launch({
  headless: false,
  args: ["--disable-blink-features=AutomationControlled"],
});

function createWorker() {
  let pagePromise = null;
  let uses = TOKENS_PER_LOAD;
  async function page() {
    if (!pagePromise) {
      pagePromise = browser
        .newContext({ viewport: { width: 1280, height: 900 } })
        .then((context) => context.newPage());
    }
    return pagePromise;
  }
  async function load(p) {
    await p.goto(INVENTORY_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    const challenge = p.url().includes("/.well-known/");
    if (challenge) throw new Error("upullrparts.com served its robot challenge to this sandbox: " + p.url());
    await p.getByText("Search By Vehicle").first().click({ timeout: 30000 });
    uses = 0;
  }
  async function token(p) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const ready = await p
        .waitForFunction(() => Reflect.get(window, "upullTurnstileReady") === true, null, { timeout: 6000, polling: 250 })
        .then(() => true, () => false);
      if (ready) return;
      const widget = p.locator("#upull-turnstile");
      await widget.scrollIntoViewIfNeeded().catch(() => undefined);
      const box = await widget.boundingBox().catch(() => null);
      if (box) await p.mouse.click(box.x + 28, box.y + box.height / 2);
    }
    throw new Error("Turnstile did not issue a token after 8 attempts");
  }
  return async function search(params) {
    const p = await page();
    if (uses >= TOKENS_PER_LOAD) await load(p);
    await token(p);
    uses += 1;
    const result = await p.evaluate(async (params) => {
      const getToken = Reflect.get(window, "getTurnstileToken");
      const refresh = Reflect.get(window, "refreshTurnstile");
      if (typeof getToken !== "function" || typeof refresh !== "function")
        return { ok: false, error: "the inventory page no longer exposes its Turnstile helpers" };
      const turnstileToken = getToken();
      refresh();
      const response = await fetch("/wp-admin/admin-ajax.php", {
        method: "POST",
        body: new URLSearchParams({
          action: "doAaaApiCall",
          apiAction: "getVehicles",
          beginDate: "",
          endDate: "",
          turnstileToken,
          ...params,
        }),
      });
      const text = await response.text();
      return response.ok
        ? { ok: true, text }
        : { ok: false, error: "HTTP " + response.status + ": " + text.slice(0, 200) };
    }, params);
    if (!result.ok) throw new Error(result.error);
    const rows = JSON.parse(result.text);
    if (!Array.isArray(rows)) throw new Error("getVehicles did not return an array: " + result.text.slice(0, 200));
    return rows;
  };
}

const idle = Array.from({ length: WORKERS }, createWorker);
const waiting = [];
async function withWorker(task) {
  const worker = idle.pop() ?? (await new Promise((resolve) => waiting.push(resolve)));
  try {
    return await task(worker);
  } finally {
    const next = waiting.shift();
    if (next) next(worker);
    else idle.push(worker);
  }
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

http
  .createServer(async (request, response) => {
    if (request.headers.authorization !== "Bearer " + AUTH) return send(response, 401, { error: "unauthorized" });
    if (request.method === "GET" && request.url === "/health") return send(response, 200, { ready: true, workers: WORKERS });
    if (request.method !== "POST" || request.url !== "/search") return send(response, 404, { error: "not found" });
    let body = "";
    for await (const chunk of request) body += chunk;
    let params;
    try {
      const parsed = JSON.parse(body);
      params = {
        site: String(parsed.site),
        makes: String(parsed.makes),
        models: String(parsed.models ?? "0"),
        years: String(parsed.years ?? "0"),
      };
    } catch {
      return send(response, 400, { error: "body must be JSON with site and makes" });
    }
    try {
      const rows = await withWorker((search) => search(params));
      send(response, 200, { rows });
    } catch (error) {
      send(response, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  })
  .listen(PORT, () => console.log("upullrparts search server listening on " + PORT));
`;
