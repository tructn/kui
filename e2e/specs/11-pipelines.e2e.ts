import { $, $$, browser, expect } from "@wdio/globals";

import { button, clearCommands, ensureCluster, expectNoChangingCommands, goTo, openDialog, snapshot } from "../helpers.js";

/**
 * Builds a pipeline body from a pasted, nested sample and checks the preview. Saving is left out:
 * it stores the webhook URL in the system keychain, which the e2e container doesn't have.
 */
describe("Pipelines", () => {
  before(ensureCluster);

  // No doubled letters in typed text: the WebKitGTK driver drops the second one.
  const SAMPLE = JSON.stringify({
    id: "A-1",
    status: "paid",
    customer: { name: "Ada" },
    items: [
      { sku: "X-1", qty: "2" },
      { sku: "Y-7", qty: "5" },
    ],
  });

  const pick = (path: string) => $(`button[aria-label="Add ${path}"]`).click();
  /** A box on the graph, by the start of its accessible name ("Transform 2: …"). */
  const box = (title: string) => $(`.react-flow button[aria-label^="${title}:"]`);
  const preview = () => $('[aria-label="Body preview"]');
  const expectPreview = (text: string) => expect(preview()).toHaveText(expect.stringContaining(text));

  it("opens on the topic and its newest message", async () => {
    await clearCommands();
    await goTo("Pipelines");
    await button("New pipeline").click();
    const dialog = openDialog();
    await dialog.$('input[aria-label="Name"]').setValue("Order lines");

    await dialog.$("button*=Choose a topic").click();
    await $('[aria-label="Search topics"]').setValue("demo.orders");
    await $('[cmdk-item][data-value="demo.orders"]').click();
    await expect(box("Topic")).toHaveAttribute("aria-label", expect.stringContaining("demo.orders"));
    // demo.orders holds flat orders; the newest one is the sample every route receives. It sits in a
    // pane that starts collapsed.
    await dialog.$("button*=Sample").click();
    await expect($("span*=newest on demo.orders")).toBeDisplayed();
    await expect($('pre[aria-label="Sample message as read"]')).toHaveText(expect.stringContaining("orderId"));

    await box("Transform").click();
    await $('//label[contains(., "Pick the fields to send")]//button[@role="switch"]').click();
    await expect($('button[aria-label="Add value.orderId"]')).toBeDisplayed();
  });

  it("maps fields, groups and every item of a list, showing each value", async () => {
    await $('button[aria-label="Edit the sample"]').click();
    await $("#sample-value").setValue(SAMPLE);
    await expect($("span*=edited")).toBeDisplayed();

    await pick("value.id");
    await pick("value.status");
    await expectPreview('"status": "paid"');
    // Each row shows what it would send for the sample.
    await expect($('span[title="\\"paid\\""]')).toBeDisplayed();

    await pick("value.items");
    await $('button[aria-label="Map each item of items"]').click();
    await expect($('[role="group"][aria-label="List items"]')).toBeDisplayed();
    await pick("item.sku");
    await pick("item.qty");
    await pick("value.id");
    // The list's `id` is the second one; rename it so every line names its order.
    await $$('input[aria-label="Name of id"]')[1].setValue("order");

    await $('button[aria-label="More for qty"]').click();
    await $('[role="menuitem"]*=Convert').click();
    await $('[role="menuitemradio"]*=To number').click();

    await expectPreview('"sku": "Y-7"');
    await expectPreview('"qty": 5');
    await expectPreview('"order": "A-1"');
    await snapshot("pipeline-mapping");
  });

  it("sends one request per item when asked", async () => {
    await $('[aria-label="Requests"]').click();
    await $('//*[@role="option"][contains(., "per item of value.items")]').click();

    await expect($("#inspector-out")).toHaveText(expect.stringContaining("first of 2"));
    // `item` is now readable everywhere, so it heads the field tree.
    await expect($('button[aria-label="Add item.sku"]')).toBeDisplayed();
    await snapshot("pipeline-per-item");
  });

  it("adds a route beside the first and removes it again", async () => {
    await button("Route").click();
    await expect(box("Transform 2")).toBeDisplayed();
    await expect(box("Webhook 2")).toBeDisplayed();
    await snapshot("pipeline-two-routes");
    await button("Remove route").click();
    await expect(box("Transform 2")).not.toExist();
    await expect(box("Transform")).toBeDisplayed();
  });

  it("never changes the cluster while a pipeline is built", async () => {
    await expectNoChangingCommands();
    await browser.keys("Escape");
    await openDialog().waitForExist({ reverse: true });
  });
});
