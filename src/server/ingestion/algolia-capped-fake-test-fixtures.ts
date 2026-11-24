/**
 * An Algolia admin client held in memory that enforces the app's record
 * cap the way the plan does: a save that would take the non-virtual indices
 * past `limit` records is refused with HTTP 403 "You have exceeded your
 * Record quota". It never sends a request.
 */

type StoredObject = Record<string, unknown>;

interface CappedIndex {
  records: Map<string, StoredObject>;
  settings: Record<string, unknown>;
  replicas: string[];
  virtual: boolean;
}

/** An Algolia HTTP answer, shaped like the client's ApiError. */
export class FakeAlgoliaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * How a browse cursor behaves when records before it are deleted: `stable`
 * resumes after the last objectID returned; `shifting` resumes at an offset,
 * so a deletion under it skips records (the sweep must recount); `anchored`
 * resumes after the last objectID returned but, as Algolia does, refuses the
 * cursor once that record was deleted.
 */
export type BrowseCursorMode = "stable" | "shifting" | "anchored";

export function cappedAlgolia(params: {
  limit: number;
  /** The most hits one browse page returns (Algolia: 1,000). */
  browsePageSize?: number;
  cursorMode?: BrowseCursorMode;
  /** Reports every index as empty in listIndices, as a lagging count can. */
  underreportEntries?: boolean;
  /** Fails the nth call (1-based) of an operation once, with a 500. */
  failOnce?: { operation: string; call: number };
}) {
  const indices = new Map<string, CappedIndex>();
  const calls: string[] = [];
  const counts = new Map<string, number>();
  let task = 0;

  const record = (operation: string, detail: string) => {
    calls.push(`${operation} ${detail}`);
    const nth = (counts.get(operation) ?? 0) + 1;
    counts.set(operation, nth);
    if (
      params.failOnce?.operation === operation &&
      params.failOnce.call === nth
    ) {
      throw new FakeAlgoliaApiError("Internal error", 500);
    }
  };
  const nextTask = () => {
    task += 1;
    return task;
  };
  const stored = () =>
    [...indices.values()]
      .filter((index) => !index.virtual)
      .reduce((total, index) => total + index.records.size, 0);
  const existing = (indexName: string): CappedIndex => {
    const found = indices.get(indexName);
    if (!found) {
      throw new FakeAlgoliaApiError(`Index ${indexName} does not exist`, 404);
    }
    return found;
  };
  const ensure = (indexName: string): CappedIndex => {
    const found = indices.get(indexName);
    if (found) return found;
    const created: CappedIndex = {
      records: new Map(),
      settings: {},
      replicas: [],
      virtual: false,
    };
    indices.set(indexName, created);
    return created;
  };

  const client = {
    async listIndices(_request: { page: number; hitsPerPage: number }) {
      record("listIndices", "");
      return {
        items: [...indices.entries()].map(([name, index]) => {
          const primary = [...indices.entries()].find(([, candidate]) =>
            candidate.replicas.includes(`virtual(${name})`),
          );
          // A virtual replica reports its primary's records as its own.
          const entries = primary?.[1].records.size ?? index.records.size;
          return {
            name,
            entries: params.underreportEntries ? 0 : entries,
            updatedAt: "2026-11-24T00:00:00.000Z",
            virtual: index.virtual,
            replicas: index.replicas,
            primary: primary?.[0],
          };
        }),
        nbPages: 1,
      };
    },
    async saveObjects(request: {
      indexName: string;
      objects: StoredObject[];
      waitForTasks?: boolean;
    }) {
      record("saveObjects", request.indexName);
      const target = ensure(request.indexName);
      const added = request.objects.filter(
        (object) => !target.records.has(String(object.objectID)),
      ).length;
      if (stored() + added > params.limit) {
        throw new FakeAlgoliaApiError(
          "You have exceeded your Record quota. You'll be able to create new records once you delete some or upgrade your plan.",
          403,
        );
      }
      for (const object of request.objects) {
        target.records.set(String(object.objectID), { ...object });
      }
      return [{ taskID: nextTask(), objectIDs: [] }];
    },
    async deleteObjects(request: {
      indexName: string;
      objectIDs: string[];
      waitForTasks?: boolean;
    }) {
      record("deleteObjects", request.indexName);
      const target = existing(request.indexName);
      for (const objectID of request.objectIDs) {
        target.records.delete(objectID);
      }
      return [{ taskID: nextTask(), objectIDs: request.objectIDs }];
    },
    async waitForTask(_request: { indexName: string; taskID: number }) {
      return {};
    },
    async browse(request: {
      indexName: string;
      browseParams: {
        cursor?: string;
        hitsPerPage: number;
        attributesToRetrieve: string[];
      };
    }) {
      record(
        "browse",
        `${request.indexName} ${request.browseParams.cursor ?? "start"}`,
      );
      const target = existing(request.indexName);
      const ids = [...target.records.keys()].sort();
      const size = Math.min(
        request.browseParams.hitsPerPage,
        params.browsePageSize ?? 1_000,
      );
      const cursor = request.browseParams.cursor;
      if (
        params.cursorMode === "anchored" &&
        cursor !== undefined &&
        !target.records.has(cursor)
      ) {
        throw new FakeAlgoliaApiError(
          "cursor is not valid anymore, the last hit of the previous query was deleted",
          400,
        );
      }
      const start =
        cursor === undefined
          ? 0
          : params.cursorMode === "shifting"
            ? Number(cursor)
            : ids.findIndex((id) => id > cursor);
      const from = start < 0 ? ids.length : start;
      const page = ids.slice(from, from + size);
      const more = from + size < ids.length;
      const last = page.at(-1);
      return {
        hits: page.map((objectID) => ({ objectID })),
        nbHits: ids.length,
        ...(more && last !== undefined
          ? {
              cursor:
                params.cursorMode === "shifting" ? String(from + size) : last,
            }
          : {}),
      };
    },
    async operationIndex(request: {
      indexName: string;
      operationIndexParams: {
        operation: "copy" | "move";
        destination: string;
        scope?: string[];
      };
    }) {
      const { operation, destination, scope } = request.operationIndexParams;
      record("operationIndex", `${operation} ${destination}`);
      const source = existing(request.indexName);
      if (operation === "move") {
        const replaced = indices.get(destination);
        indices.set(destination, {
          ...source,
          replicas: replaced?.replicas ?? source.replicas,
        });
        indices.delete(request.indexName);
      } else {
        indices.set(destination, {
          records: scope === undefined ? new Map(source.records) : new Map(),
          settings: { ...source.settings },
          replicas: [],
          virtual: false,
        });
      }
      return { taskID: nextTask() };
    },
    async clearObjects(request: { indexName: string }) {
      record("clearObjects", request.indexName);
      existing(request.indexName).records.clear();
      return { taskID: nextTask() };
    },
    async getSettings(request: { indexName: string }) {
      return { ...existing(request.indexName).settings };
    },
    async setSettings(request: {
      indexName: string;
      indexSettings: Record<string, unknown>;
    }) {
      const target = existing(request.indexName);
      target.settings = { ...target.settings, ...request.indexSettings };
      return { taskID: nextTask() };
    },
    async deleteIndex(request: { indexName: string }) {
      record("deleteIndex", request.indexName);
      existing(request.indexName);
      indices.delete(request.indexName);
      return { taskID: nextTask() };
    },
  };

  return {
    client,
    calls,
    indices,
    stored,
    /** Creates an index holding `objectIDs`, with optional virtual replicas. */
    seed(
      indexName: string,
      objectIDs: readonly string[],
      replicas: readonly string[] = [],
    ) {
      const target = ensure(indexName);
      for (const objectID of objectIDs) {
        target.records.set(objectID, { objectID, stale: true });
      }
      for (const replica of replicas) {
        target.replicas.push(`virtual(${replica})`);
        indices.set(replica, {
          records: new Map(),
          settings: { primary: indexName },
          replicas: [],
          virtual: true,
        });
      }
    },
    objectIDs(indexName: string): string[] {
      return [...(indices.get(indexName)?.records.keys() ?? [])].sort();
    },
  };
}
