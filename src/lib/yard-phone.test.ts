import { expect, test } from "bun:test";
import { yardPhoneHref } from "./yard-phone";

test.each([
  ["(800) 962-CARS", "tel:8009622277"],
  ["+1 (909) 623-6108", "tel:+19096236108"],
  ["7753594147/8600", "tel:7753594147"],
  ["(775) 841-1333/1334", "tel:7758411333"],
  ["800-555-1234 ext. 22", "tel:8005551234;ext=22"],
  ["N/A", null],
  ["Unavailable", null],
  ["(Unavailable)", null],
  ["123", null],
  [null, null],
])("builds a dialable link for %s", (phone, href) => {
  expect(yardPhoneHref(phone)).toBe(href);
});
