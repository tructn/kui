import { $, $$, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

import {
  button,
  clearCommands,
  CLUSTER_NAME,
  commandsSent,
  ensureCluster,
  expectNoChangingCommands,
  goTo,
  HOME_PAGE,
  openAlertDialog,
  openDialog,
  openSheet,
} from "../helpers.js";

/**
 * Browsing, opening dialogs and backing out, and pressing stray keys must never
 * delete a topic, change a saved cluster, copy messages or reset a consumer group.
 *
 * Each test checks two things: the UI never sent a changing command (recorded by
 * the VITE_E2E build), and the seeded data still looks the same afterwards.
 */
describe("Nothing changes without the user's consent", () => {
  before(async () => {
    await ensureCluster();
    await clearCommands();
  });

  afterEach(expectNoChangingCommands);

  it("records the commands the UI sends", async () => {
    // Without this, every check below would pass trivially on a build without VITE_E2E.
    // Brokers is the home page and already loaded, so visit pages that fetch on first open.
    await goTo("Topics");
    await goTo("Consumer groups");
    expect(await commandsSent()).toEqual(expect.arrayContaining(["list_topics", "list_consumer_groups"]));
  });

  it("browses every page, tab, message and group", async () => {
    await goTo("Brokers");
    await goTo("Topics");
    await $("span=demo.orders").click();
    await expect($("h1*=demo.orders")).toBeDisplayed();
    for (const tab of ["Consumers", "Partitions", "Configuration", "Messages"]) {
      await button(tab).click();
    }

    await openFirstMessage();
    await expect(openSheet()).toBeDisplayed();
    for (const tab of ["Key", "Headers (0)", "Value"]) await button(tab, openSheet()).click();
    await browser.keys("Escape");
    await openSheet().waitForExist({ reverse: true });

    await goTo("Consumer groups");
    await $("td=demo-billing").click();
    await expect(openSheet()).toHaveText(expect.stringContaining("Consumed 30"));
    await browser.keys("Escape");
    await openSheet().waitForExist({ reverse: true });
  });

  it("ignores stray keys on a focused topic row", async () => {
    await goTo("Topics");
    const row = await $("span=demo.orders").$("./ancestor::tr").getElement();
    await browser.execute((el) => (el as unknown as HTMLElement).focus(), row);
    // Moving around, paging, and keys people might expect to delete something.
    for (const key of ["j", "k", "]", "[", Key.Delete, Key.Backspace]) await browser.keys(key);
    await expect($("h1=Topics")).toBeDisplayed();
    await expect(openAlertDialog()).not.toBeExisting();
    await expectSeedUntouched();
  });

  it("uses keyboard shortcuts for search, live tail, settings and navigation", async () => {
    await pressMod("k");
    await $('[data-slot="command-input"]').setValue("demo.customers");
    await browser.keys(Key.Enter);
    await expect($("h1*=demo.customers")).toBeDisplayed();
    // Plain-key shortcuts are ignored while a dialog is still fading out.
    await openDialog().waitForExist({ reverse: true });

    // `l` toggles the live tail on and off.
    await browser.keys("l");
    await expect($("#live-tail")).toHaveAttribute("data-state", "checked");
    await browser.keys("l");
    await expect($("#live-tail")).toHaveAttribute("data-state", "unchecked");

    await pressMod(",");
    await expect(openDialog()).toBeDisplayed();
    await browser.keys("Escape");
    await openDialog().waitForExist({ reverse: true });

    for (const [key, heading] of [
      ["1", "Brokers"],
      ["3", "Consumer groups"],
      ["2", "Topics"],
    ]) {
      await pressMod(key);
      await expect($(`h1*=${heading}`)).toBeDisplayed();
    }
  });

  describe("deleting topics", () => {
    it("keeps the topic when its delete dialog is cancelled", async () => {
      await goTo("Topics");
      await $('button[aria-label="Delete demo.orders"]').click();
      await expect(openAlertDialog()).toBeDisplayed();
      await button("Cancel", openAlertDialog()).click();
      await openAlertDialog().waitForExist({ reverse: true });
      await expectSeedUntouched();
    });

    it("keeps the topic when Enter is pressed in its delete dialog", async () => {
      await $('button[aria-label="Delete demo.orders"]').click();
      // The dialog focuses Cancel, so an Enter meant for something else dismisses it.
      await pressEnterOnCancel();
      await openAlertDialog().waitForExist({ reverse: true });
      await expectSeedUntouched();
    });

    it("needs the exact topic name before Delete is enabled", async () => {
      await $('button[aria-label="Delete demo.orders"]').click();
      const input = openAlertDialog().$('input[aria-label="Topic name"]');
      const confirm = button("Delete", openAlertDialog());
      for (const attempt of ["demo.order", "Demo.Orders", "demo.orders "]) {
        await input.clearValue();
        await input.setValue(attempt);
        await expect(confirm).toBeDisabled();
      }
      await browser.keys(Key.Enter);
      await browser.keys("Escape");
      await openAlertDialog().waitForExist({ reverse: true });
      await expectSeedUntouched();
    });

    it("keeps the topic when deleting from its own page is cancelled", async () => {
      await $("span=demo.orders").click();
      await expect($("h1*=demo.orders")).toBeDisplayed();
      await button("Delete").click();
      await openAlertDialog().waitForDisplayed();
      await browser.keys("Escape");
      await openAlertDialog().waitForExist({ reverse: true });
      await expect($("h1*=demo.orders")).toBeDisplayed();
    });

    it("keeps selected topics when the bulk delete phrase is wrong or cancelled", async () => {
      await goTo("Topics");
      await $('button[aria-label="Select demo.orders"]').click();
      await $('button[aria-label="Select demo.customers"]').click();
      await button("Delete 2 topics").click();

      const input = openAlertDialog().$('input[aria-label="Confirmation"]');
      await input.setValue("delete 2 topic");
      await expect(button("Delete 2", openAlertDialog())).toBeDisabled();
      await browser.keys(Key.Enter);
      await button("Cancel", openAlertDialog()).click();
      await openAlertDialog().waitForExist({ reverse: true });

      // Selecting topics is not consent either: clearing the selection leaves them alone.
      await button("Clear").click();
      await expectSeedUntouched();
    });
  });

  describe("saved clusters", () => {
    it("keeps the connection when an edit is abandoned", async () => {
      await openClusterMenu();
      await menuItem(`Edit ${CLUSTER_NAME}`).click();
      await $("#cluster-name").clearValue();
      await $("#cluster-name").setValue("Renamed by accident");
      await $("#cluster-bootstrap").clearValue();
      await $("#cluster-bootstrap").setValue("127.0.0.1:1");
      await browser.keys("Escape");
      await openDialog().waitForExist({ reverse: true });

      // Reopening shows the saved values, not the abandoned edit.
      await openClusterMenu();
      await menuItem(`Edit ${CLUSTER_NAME}`).click();
      await expect($("#cluster-name")).toHaveValue(CLUSTER_NAME);
      await browser.keys("Escape");
      await openDialog().waitForExist({ reverse: true });
    });

    it("keeps the connection when Remove is cancelled or answered with Enter", async () => {
      await openClusterMenu();
      await menuItem(`Remove ${CLUSTER_NAME}`).click();
      await button("Cancel", openAlertDialog()).click();
      await openAlertDialog().waitForExist({ reverse: true });

      await openClusterMenu();
      await menuItem(`Remove ${CLUSTER_NAME}`).click();
      await pressEnterOnCancel();
      await openAlertDialog().waitForExist({ reverse: true });

      await expect($(`span=${CLUSTER_NAME}`)).toBeDisplayed();
      await expect($("h1=Topics")).toBeDisplayed();
    });

    it("does not save anything when switching to the current cluster", async () => {
      await openClusterMenu();
      await menuItem(CLUSTER_NAME).click();
      // Selecting a cluster opens its home page.
      await expect($(`h1=${HOME_PAGE}`)).toBeDisplayed();
    });
  });

  describe("copying and producing messages", () => {
    before(async () => {
      await goTo("Topics");
      await $("span=demo.orders").click();
      await expect($("h1*=demo.orders")).toBeDisplayed();
    });

    it("copies nothing when the copy dialog of one message is closed", async () => {
      await openFirstMessage();
      await button("Copy to topic", openSheet()).click();
      await expect(openDialog()).toBeDisplayed();

      // Pick another topic, as if about to copy there, then back out.
      await $("#copy-target-topic").click();
      await $('[data-slot="command-item"][data-value="demo.customers"]').click();
      await expect(button("Copy", openDialog())).toBeDisplayed();
      // While the picker is still fading out it takes the Escape meant for the dialog.
      await $('[data-slot="popover-content"]').waitForExist({ reverse: true });
      await browser.keys("Escape");
      await openDialog().waitForExist({ reverse: true });
      await browser.keys("Escape");
      await openSheet().waitForExist({ reverse: true });
    });

    it("copies nothing when the copy dialog of selected messages is closed", async () => {
      const boxes = await $$('[role="tabpanel"][data-state="active"] button[aria-label^="Select partition"]');
      await boxes[0].click();
      await boxes[1].click();
      await $("button*=Copy 2 to topic").click();
      await expect(openDialog()).toBeDisplayed();
      await browser.keys("Escape");
      await openDialog().waitForExist({ reverse: true });
      await button("Clear").click();
    });

    it("sends nothing when the produce and generate dialogs are closed", async () => {
      for (const opener of ["Produce", "Generate"]) {
        await button(opener).click();
        await expect(openDialog()).toBeDisplayed();
        await browser.keys("Escape");
        await openDialog().waitForExist({ reverse: true });
      }
      await expectSeedUntouched();
    });
  });

  describe("consumer group offsets", () => {
    before(async () => {
      await goTo("Consumer groups");
      await $("td=demo-billing").click();
      await expect(openSheet()).toHaveText(expect.stringContaining("Consumed 30"));
    });

    it("only previews a reset until it is confirmed", async () => {
      await clearCommands();
      await button("Reset offsets", openSheet()).click();
      await expect(openDialog()).toBeDisplayed();

      // Switch the target to Latest and wait for the preview of the new offsets.
      await (await openDialog().$$('button[role="combobox"]'))[2].click();
      await $('[role="option"]*=Latest').click();
      await expect(openDialog().$("button*=Reset 3 partitions")).toBeEnabled();
      expect(await commandsSent()).toContain("preview_offset_reset");

      await browser.keys("Escape");
      await openDialog().waitForExist({ reverse: true });
    });

    it("resets nothing when the per-topic reset is closed", async () => {
      await openSheet().$('button[aria-label="Reset offsets on demo.orders"]').click();
      await expect(openDialog()).toBeDisplayed();
      await browser.keys("Escape");
      await openDialog().waitForExist({ reverse: true });
    });

    it("keeps the group when Delete group is cancelled or answered with Enter", async () => {
      await button("Delete group", openSheet()).click();
      await button("Cancel", openAlertDialog()).click();
      await openAlertDialog().waitForExist({ reverse: true });

      await button("Delete group", openSheet()).click();
      await pressEnterOnCancel();
      await openAlertDialog().waitForExist({ reverse: true });

      await expect(openSheet()).toBeDisplayed();
      await browser.keys("Escape");
      await openSheet().waitForExist({ reverse: true });
    });
  });

  it("leaves the seeded topics and group exactly as they were", async () => {
    await expectSeedUntouched();
  });
});

/**
 * Opens the first message of the visible tab in the side sheet. Clicks a narrow cell
 * (the partition), not the row: the row's centre can sit off-screen in a wide table.
 */
async function openFirstMessage() {
  const rows = await $$('[role="tabpanel"][data-state="active"] tbody tr');
  await (await rows[0].$$("td.tabular-nums"))[0].click();
}

/** Waits until the open alert dialog has focused its Cancel button, then presses Enter. */
async function pressEnterOnCancel() {
  await openAlertDialog().waitForDisplayed();
  await browser.waitUntil(() => browser.execute(() => document.activeElement?.textContent?.trim() === "Cancel"), {
    timeoutMsg: "The confirmation dialog did not focus Cancel",
  });
  await browser.keys(Key.Enter);
}

/** Presses ⌘/Ctrl + key. tauri-driver runs on Linux, where mod is Ctrl. */
async function pressMod(key: string) {
  await browser.action("key").down(Key.Ctrl).down(key).up(key).up(Key.Ctrl).perform();
}

async function openClusterMenu() {
  await $('[data-sidebar="menu-button"][data-size="lg"]').click();
  await $('[role="menu"]').waitForDisplayed();
}

function menuItem(text: string) {
  return $(`[role="menuitem"]=${text}`);
}

/** demo.orders still has its 50 messages and demo-billing still has 30 of them consumed. */
async function expectSeedUntouched() {
  await goTo("Topics");
  const orders = $("span=demo.orders").parentElement().parentElement().parentElement();
  await expect(orders).toHaveText(expect.stringContaining("50"));
  await expect($("span=demo.customers")).toBeExisting();

  await goTo("Consumer groups");
  await $("td=demo-billing").click();
  await expect(openSheet()).toHaveText(expect.stringContaining("Remaining 20"));
  await expect(openSheet()).toHaveText(expect.stringContaining("Consumed 30"));
  await browser.keys("Escape");
  await openSheet().waitForExist({ reverse: true });
  await goTo("Topics");
}
