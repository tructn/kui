import { describe, expect, test } from "bun:test";

import { prettyXml } from "./format";

describe("prettyXml", () => {
  test("one element per line, short text inline", () => {
    expect(prettyXml('<?xml version="1.0"?><order id="1"><item>A</item><empty></empty><br/></order>')).toBe(
      ['<?xml version="1.0"?>', '<order id="1">', "  <item>A</item>", "  <empty></empty>", "  <br/>", "</order>"].join(
        "\n",
      ),
    );
  });

  test("comments and CDATA stay intact", () => {
    expect(prettyXml("<a><!-- <b> --><![CDATA[<x>]]></a>")).toBe("<a>\n  <!-- <b> -->\n  <![CDATA[<x>]]>\n</a>");
  });

  test("already-indented XML comes out the same", () => {
    const xml = "<a>\n  <b>x</b>\n</a>";
    expect(prettyXml(xml)).toBe(xml);
  });
});
