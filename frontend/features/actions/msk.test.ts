import { expect, test } from "bun:test";

import { decodedMskValue } from "./msk";

const event = (value: unknown) =>
  JSON.stringify({ eventSource: "aws:kafka", records: { "demo.orders-0": [{ offset: 1, value }] } });

test("decodes the record value as UTF-8", () => {
  expect(decodedMskValue(event(btoa('{"total":1}')))).toBe('{"total":1}');
  // "café" in UTF-8, which atob alone would garble.
  expect(decodedMskValue(event("Y2Fmw6k="))).toBe("café");
});

test("null for anything that isn't an MSK event with a value", () => {
  expect(decodedMskValue('{"total":1}')).toBeNull();
  expect(decodedMskValue("not json")).toBeNull();
  expect(decodedMskValue(event(undefined))).toBeNull();
  expect(decodedMskValue(event("%%%"))).toBeNull();
});
