import { describe, expect, test } from "bun:test";

import { inferStructures, type SampleRecord } from "./infer";

function record(value: string | null, key: string | null = null, headers: SampleRecord["headers"] = []): SampleRecord {
  const payload = (text: string | null) => (text === null ? null : { text, encoding: "utf8" as const });
  return { key: payload(key), value: payload(value), headers };
}

const json = (value: unknown) => JSON.stringify(value);

describe("inferStructures", () => {
  test("groups messages by shape, most common first", () => {
    const structures = inferStructures([
      record(json({ a: 1 })),
      record(json({ b: "x", c: { d: true } })),
      record(json({ a: 2 })),
      record(json({ a: null })),
    ]);
    expect(structures.map((s) => [s.fields, s.count])).toEqual([
      [["a"], 3],
      [["b", "c"], 1],
    ]);
  });

  test("builds a template that keeps the nesting and picks placeholders from values and names", () => {
    const [structure] = inferStructures([
      record(
        json({
          id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
          customer: { email: "a@b.io", firstName: "Ada", country: "FR" },
          status: "paid",
          amount: 12.5,
          quantity: 1,
          ok: true,
          createdAt: "2026-01-01T10:00:00Z",
          tags: ["a"],
        }),
        "order-7",
      ),
      record(
        json({
          id: "9b2e28ba-2fa1-11d2-883f-0016d3cca427",
          customer: { email: "c@d.io", firstName: "Bo", country: "DE" },
          status: "shipped",
          amount: 99.99,
          quantity: 3,
          ok: false,
          createdAt: "2026-01-02T10:00:00Z",
          tags: ["b", "c"],
        }),
        "order-12",
      ),
    ]);
    expect(structure.template.key).toBe("order-{{seq 13}}");
    expect(structure.template.value).toBe(`{
  "id": "{{uuid}}",
  "customer": {
    "email": "{{email}}",
    "firstName": "{{first_name}}",
    "country": "{{country_code}}"
  },
  "status": "{{pick paid shipped}}",
  "amount": {{float 12.5 99.99 2}},
  "quantity": {{int 1 3}},
  "ok": {{bool 50}},
  "createdAt": "{{now_iso}}",
  "tags": [
    "{{pick a b c}}"
  ]
}`);
  });

  test("turns epoch millis into {{now}} and distinct ids into a sequence after the sampled ones", () => {
    const [structure] = inferStructures([
      record(json({ userId: 4, ts: 1_760_000_000_000 })),
      record(json({ userId: 9, ts: 1_760_000_100_000 })),
    ]);
    expect(structure.template.value).toContain('"userId": {{seq 10}}');
    expect(structure.template.value).toContain('"ts": {{now}}');
  });

  test("keeps the width of fixed-format strings with {{digits}}", () => {
    const [structure] = inferStructures([record(json({ account: "ACC-0012" })), record(json({ account: "ACC-0042" }))]);
    expect(structure.template.value).toContain('"account": "{{digits "ACC-####"}}"');
  });

  test("quotes pick values with spaces and leaves out values that would break the template", () => {
    const [spaced] = inferStructures([record(json({ s: "in transit" })), record(json({ s: "new" }))]);
    expect(spaced.template.value).toContain('{{pick "in transit" new}}');
    const [unsafe] = inferStructures([record(json({ s: 'say "hi"' })), record(json({ s: "{{uuid}}" }))]);
    expect(unsafe.template.value).not.toContain("pick");
  });

  test("escapes braces in keys so they aren't read as placeholders", () => {
    const [structure] = inferStructures([record(json({ "{{x}}": 1 }))]);
    expect(structure.template.value).toContain('"{\\u007bx}}": 1');
  });

  test("infers header templates and drops names that can't be written as name=value", () => {
    const [structure] = inferStructures([
      record(json({ a: 1 }), null, [
        { key: "trace-id", value: "1b4e28ba-2fa1-11d2-883f-0016d3cca427" },
        { key: "a=b", value: "x" },
      ]),
    ]);
    expect(structure.template.headers).toEqual([{ key: "trace-id", value: "{{uuid}}" }]);
    expect(structure.template.key).toBeNull();
  });

  test("treats non-JSON values as text", () => {
    const [structure] = inferStructures([
      record("the quick brown fox jumps over the lazy dog again and again"),
      record("one two three four five six seven eight nine ten"),
    ]);
    expect(structure.kind).toBe("text");
    expect(structure.template.value).toBe("{{sentence}}");
  });

  test("skips tombstones, binary and truncated values", () => {
    expect(
      inferStructures([
        record(null),
        { key: null, value: { text: "ff00", encoding: "hex" }, headers: [] },
        { key: null, value: { text: '{"a":', encoding: "utf8", truncated: true }, headers: [] },
      ]),
    ).toEqual([]);
  });

  test("stops at a depth limit instead of overflowing the stack", () => {
    const deep = "[".repeat(5000) + "]".repeat(5000);
    expect(() => inferStructures([record(deep)])).not.toThrow();
  });
});
