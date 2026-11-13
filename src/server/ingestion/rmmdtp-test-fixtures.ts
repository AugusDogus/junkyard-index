import { readFileSync } from "node:fs";
export const rmmdtpFixture = (stage: "opening" | "closing", page: number) =>
  readFileSync(
    new URL(`./rmmdtp-test-fixtures/${stage}-${page}.html`, import.meta.url),
    "utf8",
  );
