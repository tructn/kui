import { $, $$, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

import { button, ensureCluster, goTo, snapshot } from "../helpers.js";

/** The SQL-like filter over demo.orders (seeded: 50 orders, every third SHIPPED → 17). */
describe("Message query", () => {
  before(ensureCluster);

  const editor = () => $('[aria-label="Message filter"]');
  const suggestions = () => $$(".cm-tooltip-autocomplete li");
  const suggestion = (text: string) => $(".cm-tooltip-autocomplete").$(`li*=${text}`);

  it("suggests fields, operators and values from the messages", async () => {
    await goTo("Topics");
    await $("span=demo.orders").click();
    await button("Messages").click();

    await editor().click();
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
    if (await button("Clear filter").isExisting()) await button("Clear filter").click();
    await editor().click();
    await browser.keys("value.total >");
    await expect($("p[role=alert]")).toHaveText("Expected a field or value");
    await expect($(".cm-lintRange-error")).toExist();
    await expect(button("Apply")).toBeDisabled();
    await button("Clear filter").click();
  });
});
