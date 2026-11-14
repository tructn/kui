import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

import { button, ensureCluster, goTo, openDialog, openSheet, snapshot } from "../helpers.js";

/**
 * Captures the README screenshots as e2e/artifacts/readme-*.png. Copy them to
 * docs/screenshots by hand when the UI changes.
 */
describe("README screenshots", () => {
  const theme = (label: string) => $(`button[aria-label="${label}"]`);
  /** Lets dialogs and sheets finish animating in. */
  const settle = () => browser.pause(500);

  before(async () => {
    await ensureCluster();
    await theme("Dark").click();
  });

  // The theme is a saved setting, and later specs share the app's data directory.
  after(async () => {
    await browser.keys(Key.Escape);
    // Settings has its own theme buttons, so wait for it to close.
    await openDialog().waitForExist({ reverse: true });
    await theme("System").click();
  });

  it("the Add cluster dialog", async () => {
    await $('[data-sidebar="menu-button"][data-size="lg"]').click();
    await $('[role="menuitem"]*=Add cluster').click();
    await $("#cluster-name").setValue("Production");
    // Keeps the default bootstrap address: the WebKitGTK driver drops most of a typed host name.
    await expect($("#cluster-bootstrap")).toHaveValue("localhost:9092");
    await settle();
    await snapshot("readme-00_cluster");
    await browser.keys(Key.Escape);
  });

  it("the topics list", async () => {
    await openDialog().waitForExist({ reverse: true });
    await goTo("Topics");
    await expect($("span=demo.orders")).toBeDisplayed();
    await snapshot("readme-01_topics");
  });

  it("messages filtered in the expanded editor", async () => {
    await $("span=demo.orders").click();
    await button("Messages").click();
    await $('button[aria-label="Expand filter editor"]').click();
    await $('[aria-label="Message filter"]').click();
    // No doubled letters or digits: the WebKitGTK driver drops the second one.
    await browser.keys("value.customer = 'cust-1' OR value.total > 450");
    await browser.keys(Key.Escape);
    await browser.keys([Key.Ctrl, Key.Enter]);
    await expect($("span*=matches")).toBeDisplayed();
    await snapshot("readme-02_messages");
  });

  it("a consumer group's progress", async () => {
    await goTo("Consumer groups");
    await $("td=demo-billing").click();
    await expect(openSheet()).toHaveText(expect.stringContaining("Remaining 20"));
    await settle();
    await snapshot("readme-03_consumers");
    await browser.keys(Key.Escape);
  });

  it("the Settings dialog", async () => {
    await openSheet().waitForExist({ reverse: true });
    await $(`//*[@data-sidebar="menu-button"][.//span[normalize-space()="Settings"]]`).click();
    await $("button*=Appearance").click();
    await expect(openDialog()).toHaveText(expect.stringContaining("Code font"));
    await settle();
    await snapshot("readme-04_settings");
  });
});
