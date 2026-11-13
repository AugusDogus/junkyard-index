import { readFileSync } from "node:fs";

const fixture = (name: string) =>
  readFileSync(
    new URL(`./speedys-test-fixtures/${name}.html`, import.meta.url),
    "utf8",
  );
export const speedysSaved = {
  default: fixture("default"),
  all: fixture("all"),
  nissan: fixture("nissan"),
  detail: fixture("detail"),
  closingAll: fixture("closing-all"),
  closingDetail: fixture("closing-detail"),
};
