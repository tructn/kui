import { $, $$, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

import { button, ensureCluster, goTo, snapshot } from "../helpers.js";

/** The SQL-like filter over demo.orders (seeded: 50 orders, every third SHIPPED → 17). */
describe("Message query", () => {
  before(ensureCluster);

  const editor = () => $('[aria-label="Message filter"]');
  const suggestions = () => $$(".cm-tooltip-autocomplete li");
  /** A suggestion by its exact label (LIKE, not ILIKE or NOT LIKE). */
  const suggestion = (label: string) => $(".cm-tooltip-autocomplete").$(`span.cm-completionLabel=${label}`);
  const clearButton = () => $('button[aria-label="Clear filter"]');

  it("suggests fields, operators and values from the messages", async () => {
    await goTo("Topics");
    await $("span=demo.orders").click();
    await button("Messages").click();

    await editor().click();
    // Clicking in only focuses; suggestions wait for typing or Ctrl+Space.
    await browser.pause(500);
    await expect(suggestions()).toBeElementsArrayOfSize(0);
    await browser.keys([Key.Ctrl, Key.Space]);
    await expect(suggestions()).toBeElementsArrayOfSize({ gte: 1 });
    await browser.keys(Key.Escape);
    // A field found by name alone, without knowing it sits under `value`.
    await browser.keys("stat");
    await expect(suggestion("value.status")).toBeDisplayed();
    await snapshot("query-field-suggestions");
    await browser.keys(Key.Enter);

    // Operators for a text field, then values that occur in it.
    await expect(suggestion("LIKE")).toBeDisplayed();
    await browser.keys(["=", " "]);
    await expect(suggestion("'SHIPPED'")).toBeDisplayed();
    await snapshot("query-value-suggestions");
    await browser.keys("'SHIP");
    await expect(suggestions()).toBeElementsArrayOfSize(1);
    await browser.keys(Key.Enter); // accept 'SHIPPED'
    await browser.keys(Key.Escape); // close the AND / OR suggestions
    await expect(editor()).toHaveText("value.status = 'SHIPPED'");

    await browser.keys(Key.Enter); // run it
    await expect($("span*=17 matches")).toBeDisplayed();
    await expect($('[data-testid="search-status"]')).toHaveText(expect.stringContaining("Searched 50 messages"));
    await snapshot("query-results");
  });

  it("underlines mistakes and won't run them", async () => {
    if (await clearButton().isExisting()) await clearButton().click();
    // Empty: CodeMirror shows its placeholder, which WebDriver reads as the editor's text.
    await expect(editor().$(".cm-placeholder")).toExist();
    await editor().click();
    await browser.keys("value.total >");
    await expect($("p[role=alert]")).toHaveText("Expected a field or value");
    await expect($(".cm-lintRange-error")).toExist();
    await expect(button("Apply")).toBeDisabled();
    await clearButton().click();
  });

  // demo.events: 60 events in six shapes (see docker/kafka-seed.sh), 9 with an item of qty > 3.
  it("filters nested, mixed-shape messages", async () => {
    await goTo("Topics");
    await $("span=demo.events").click();
    await button("Messages").click();

    await editor().click();
    // A path four levels deep. (No doubled letters: the WebKitGTK driver drops the second one.)
    await browser.keys("value.payment.card.br");
    await expect(suggestion("brand")).toBeDisplayed();
    await browser.keys(Key.Escape);
    if (await clearButton().isExisting()) await clearButton().click();

    await editor().click();
    await browser.keys("value.items[*].qty > 3");
    await browser.keys(Key.Escape);
    await browser.keys(Key.Enter);
    await expect($("span*=9 matches")).toBeDisplayed();
  });

  // demo.analytics: `properties` is JSON written as a string, with `context`, another
  // JSON string, inside it. 10 of the 40 events are from VN.
  it("goes inside JSON written as a string", async () => {
    await goTo("Topics");
    await $("span=demo.analytics").click();
    await button("Messages").click();

    await editor().click();
    // Suggested like an object, two string levels down.
    await browser.keys("value.properties.cont");
    await expect(suggestion("context")).toBeDisplayed();
    await browser.keys(Key.Escape);
    if (await clearButton().isExisting()) await clearButton().click();

    await editor().click();
    await browser.keys("value.properties.context.geo.cc = 'VN'");
    await browser.keys(Key.Escape);
    await browser.keys(Key.Enter);
    await expect($("span*=10 matches")).toBeDisplayed();
  });
});
