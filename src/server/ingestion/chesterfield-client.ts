import { ingestionValidation } from "./ingestion-validation";
import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  ChesterfieldQuerySchema,
  parseChesterfieldForm,
  parseChesterfieldInventory,
  type ChesterfieldQuery,
  type ChesterfieldRecord,
} from "./chesterfield-parser";
import type { ProviderRequestGate } from "./provider-http-client";

export const CHESTERFIELD_ORIGIN = "https://chesterfieldauto.com";
export const CHESTERFIELD_INVENTORY_URL =
  CHESTERFIELD_ORIGIN + "/search-our-inventory-by-location";
type Form = ReturnType<typeof parseChesterfieldForm>;

export class ChesterfieldProviderError extends Data.TaggedError(
  "ChesterfieldProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return `Chesterfield ${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}. No advanced checkpoint is accepted and published inventory is preserved. Inspect the native response and retry the last validated checkpoint.`;
  }
}

export interface ChesterfieldSession {
  html: string;
  makes: Form["makes"];
  lower: string;
  upper: string;
  directory(
    makeId: string,
  ): Effect.Effect<Form["models"], ChesterfieldProviderError>;
  search(
    query: ChesterfieldQuery,
  ): Effect.Effect<ChesterfieldRecord[], ChesterfieldProviderError>;
  newest(): Effect.Effect<ChesterfieldRecord[], ChesterfieldProviderError>;
}

export const ChesterfieldSession = {
  /** Same-session public form state stays in memory, outside durable cursors. */
  open(
    gate: ProviderRequestGate,
  ): Effect.Effect<ChesterfieldSession, ChesterfieldProviderError> {
    return Effect.gen(function* () {
      const cookies = new Map<string, string>();
      function request(path: string, body?: string) {
        const url = CHESTERFIELD_ORIGIN + path;
        return gate(
          Effect.tryPromise({
            try: async (signal) => {
              const timeout = AbortSignal.any([
                signal,
                AbortSignal.timeout(20_000),
              ]);
              const response = await fetch(url, {
                method: body === undefined ? "GET" : "POST",
                body,
                redirect: "error",
                signal: timeout,
                headers: {
                  "User-Agent": "JunkyardIndex/1.0",
                  Accept: "text/html",
                  ...(cookies.size
                    ? {
                        Cookie: [...cookies]
                          .map(([name, value]) => `${name}=${value}`)
                          .join("; "),
                      }
                    : {}),
                  ...(body === undefined
                    ? {}
                    : { "Content-Type": "application/x-www-form-urlencoded" }),
                },
              });
              if (
                response.status !== 200 ||
                response.headers.has("content-range") ||
                response.headers
                  .get("content-type")
                  ?.split(";")[0]
                  ?.trim()
                  .toLowerCase() !== "text/html" ||
                (response.url && response.url !== url)
              ) {
                await response.body?.cancel();
                throw new Error(
                  `Native form returned unexpected HTTP ${response.status}, MIME, range or destination`,
                );
              }
              const html = await readIPullUPullResponseText(
                response,
                "Chesterfield " + path,
                timeout,
              );
              for (const cookie of response.headers.getSetCookie()) {
                const pair = /^([^=;\s]+)=([^;]*)/.exec(cookie);
                if (!pair?.[1] || pair[2] === undefined || cookie.length > 8192)
                  throw new Error("Invalid native session cookie");
                cookies.set(pair[1], pair[2]);
              }
              if (cookies.size > 32)
                throw new Error("Native session cookie bound exceeded");
              return html;
            },
            catch: (cause) =>
              new ChesterfieldProviderError({
                operation: "public form request",
                cause,
              }),
          }),
        );
      }
      const initialHtml = yield* request(
        "/search-our-inventory-by-location?SelectedMake.Id=298",
      );
      const initial = yield* ingestionValidation({
        try: () => parseChesterfieldForm(initialHtml),
        catch: (cause) =>
          new ChesterfieldProviderError({ operation: "bootstrap form", cause }),
      });
      let token = initial.token;
      function parse(html: string, expected?: ChesterfieldQuery) {
        const form = parseChesterfieldForm(html, expected);
        if (
          form.lower !== initial.lower ||
          form.upper !== initial.upper ||
          JSON.stringify(
            form.makes.slice().sort((a, b) => a.id.localeCompare(b.id)),
          ) !==
            JSON.stringify(
              initial.makes.slice().sort((a, b) => a.id.localeCompare(b.id)),
            )
        )
          throw new Error(
            "Native year bounds or make directory changed within this session",
          );
        token = form.token;
        return form;
      }
      const session: ChesterfieldSession = {
        html: initialHtml,
        makes: initial.makes,
        lower: initial.lower,
        upper: initial.upper,
        directory(makeId) {
          return Effect.gen(function* () {
            if (!initial.makes.some((make) => make.id === makeId))
              return yield* Effect.fail(
                new ChesterfieldProviderError({
                  operation: "model directory",
                  cause: "Requested make is absent from the native directory",
                }),
              );
            const html = yield* request(
              "/search-our-inventory-by-location?SelectedMake.Id=" + makeId,
            );
            return yield* ingestionValidation({
              try: () => {
                const form = parse(html);
                if (form.selectedMake !== makeId)
                  throw new Error(
                    "Native make selection differs from requested directory",
                  );
                return form.models;
              },
              catch: (cause) =>
                new ChesterfieldProviderError({
                  operation: "model directory " + makeId,
                  cause,
                }),
            });
          });
        },
        search(query) {
          return Effect.gen(function* () {
            if (
              !ChesterfieldQuerySchema.safeParse(query).success ||
              !initial.makes.some((make) => make.id === query.makeId)
            )
              return yield* Effect.fail(
                new ChesterfieldProviderError({
                  operation: "search",
                  cause: "Requested native make/model IDs are invalid",
                }),
              );
            const body = new URLSearchParams({
              SelectedMake: query.makeId,
              "BasicSearch.ModelId": query.modelId,
              "BasicSearch.BeginYear": initial.lower,
              "BasicSearch.EndYear": initial.upper,
              __RequestVerificationToken: token,
            }).toString();
            const html = yield* request(
              "/search-our-inventory-by-location?SelectedMake.Id=" +
                query.makeId,
              body,
            );
            return yield* ingestionValidation({
              try: () => {
                parse(html, query);
                return parseChesterfieldInventory(html);
              },
              catch: (cause) =>
                new ChesterfieldProviderError({
                  operation: "search " + query.makeId + "/" + query.modelId,
                  cause,
                }),
            });
          });
        },
        newest() {
          return request("/newest-cars").pipe(
            Effect.flatMap((html) =>
              ingestionValidation({
                try: () => parseChesterfieldInventory(html, 3),
                catch: (cause) =>
                  new ChesterfieldProviderError({
                    operation: "independent newest controls",
                    cause,
                  }),
              }),
            ),
          );
        },
      };
      return session;
    });
  },
} as const;
