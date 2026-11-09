import { $, $$, browser, expect } from "@wdio/globals";
import type { ChainablePromiseElement } from "webdriverio";
import { Key } from "webdriverio";

import { button, clearCommands, ensureCluster, expectNoChangingCommands, goTo, openSheet } from "../helpers.js";

/**
 * Message keys, values and headers come from whoever can write to the topic, so the UI must treat them as
 * text. demo.untrusted holds HTML and script payloads that set `window.__pwned` if they ever run.
 */
describe("Untrusted message content", () => {
  before(async () => {
    await ensureCluster();
    await clearCommands();
  });

  afterEach(expectNoChangingCommands);

  /** A Tree / JSON / Base64 tab by its label (WebDriver can't combine a CSS selector with text). */
  const viewTabs = (view: string, within?: ChainablePromiseElement) =>
    (within ?? $("body")).$$(`.//button[@role="tab"][normalize-space()="${view}"]`);

  /** Nothing ran, and nothing from the payloads became an element. */
  async function expectInert() {
    // `execute` turns undefined into null, so ask whether the property exists at all.
    const { pwned, injected } = await browser.execute(() => ({
      pwned: "__pwned" in window,
      // `img[src="x"]` and `#injected` only exist if a payload was parsed as HTML.
      injected: document.querySelectorAll('img[src="x"], #injected, iframe, svg[onload]').length,
    }));
    expect(pwned).toBe(false);
    expect(injected).toBe(0);
  }

  it("shows every payload as text in the table, in every view", async () => {
    await goTo("Topics");
    await $("span=demo.untrusted").click();
    await button("Messages").click();
    await expect($$('[role="tabpanel"][data-state="active"] tbody tr')).toBeElementsArrayOfSize({ gte: 6 });
    // The raw markup is on the page as characters, which also proves the payloads rendered.
    // WebKit's getText skips truncated cells, so read textContent.
    const page = await browser.execute(() => document.body.textContent ?? "");
    expect(page).toContain("<script>window.__pwned");

    await $('button[aria-label="Expand all rows"]').click();
    for (const view of ["JSON", "Tree", "Base64"]) {
      for (const tab of await viewTabs(view)) {
        if (await tab.isClickable()) await tab.click();
      }
      await expectInert();
    }
  });

  it("shows every payload as text in the message sheet", async () => {
    // The previous test left the rows expanded, and their detail rows have no numeric cells.
    // Each message row has two (partition, offset): click the partition of each.
    const numbers = await $$('[role="tabpanel"][data-state="active"] tbody td.text-right.tabular-nums');
    expect(numbers.length).toBe(12);
    for (let i = 0; i < 6; i++) {
      await numbers[i * 2].click();
      await openSheet().waitForDisplayed();
      for (const view of ["Tree", "JSON", "Base64"]) {
        for (const tab of await viewTabs(view, openSheet())) {
          if (await tab.isClickable()) await tab.click();
        }
        await expectInert();
      }
      await browser.keys(Key.Escape);
      await openSheet().waitForExist({ reverse: true });
    }
  });

  it("keeps the payloads out of the filter and the query suggestions", async () => {
    // Suggested values are built from message content, so they're the other place it is rendered.
    await $('[aria-label="Message filter"]').click();
    await browser.keys("value.html = ");
    await browser.keys([Key.Ctrl, Key.Space]);
    await browser.pause(500);
    await expectInert();
    await browser.keys(Key.Escape);
  });
});
