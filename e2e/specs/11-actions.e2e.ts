import { $, browser, expect } from "@wdio/globals";

import { startFakeSam, recordKeys, type FakeSam } from "../fake-sam.js";
import {
  actionPage,
  button,
  createTopic,
  deleteTopic,
  ensureCluster,
  expectToast,
  goTo,
  openAlertDialog,
  openDialog,
  openSheet,
  produceMessages,
  snapshot,
  typeFunction,
  uniqueName,
} from "../helpers.js";

/** Actions: a topic's messages invoke a local Lambda function, here a fake SAM endpoint. */
describe("Actions", () => {
  const topic = uniqueName("e2e.action");
  const name = uniqueName("Order processor");
  const functionName = "OrderProcessor";
  let sam: FakeSam;

  before(async () => {
    sam = await startFakeSam(functionName);
    await ensureCluster();
  });

  after(async () => {
    await sam.close();
  });

  it("starts from a topic with messages on it", async () => {
    await createTopic(topic);
    await produceMessages(["order-1", "fail-2"].map((key) => ({ key, value: `{"orderId":"${key}"}` })));
  });

  it("checks the endpoint while the action is set up", async () => {
    await goTo("Actions");
    await expect($("h2=Run your local code on every Kafka message")).toBeDisplayed();
    await $("button*=AWS Lambda").click();
    await expect(openSheet()).toBeDisplayed();

    await $("#action-name").setValue(name);
    // A new action gets its own consumer group, named after it.
    await expect($("#action-group")).toHaveValue(expect.stringMatching(/^kui-action-order-processor-/));
    await $("#action-topic").click();
    await $(`[role="option"]*=${topic}`).click();
    await openSheet().$('button[role="radio"]*=The oldest message').click();

    await openSheet().$('[role="group"][aria-label="Runs in"] button*=AWS SAM CLI').click();
    await expect($("#action-endpoint")).toHaveValue("http://127.0.0.1:3001");

    const status = $("#action-endpoint-status");
    await $("#action-endpoint").clearValue();
    // Port 9 (discard) has nothing listening in the container.
    await $("#action-endpoint").setValue("http://127.0.0.1:9");
    await expect(status).toHaveText(expect.stringContaining("Nothing is listening"));
    await expect(status).toHaveText(expect.stringContaining("sam local start-lambda"));

    await $("#action-endpoint").clearValue();
    await $("#action-endpoint").setValue(sam.endpoint);
    await expect(status).toHaveText(expect.stringContaining("SAM local is running"));
    await typeFunction(functionName);
    await snapshot("action-editor");
  });

  it("invokes the function for every message and shows each result", async () => {
    await button("Save and start", openSheet()).click();
    await expectToast(`${name} is running`);
    await openSheet().waitForExist({ reverse: true });

    await button(name).click();
    await expect(actionPage()).toBeDisplayed();
    const badges = actionPage().$$('tbody [data-slot="badge"]');
    await browser.waitUntil(async () => (await badges.length) === 2, {
      timeoutMsg: "The history did not show both executions",
    });
    await expect(actionPage().$('tbody [data-slot="badge"]=Succeeded')).toBeExisting();
    await expect(actionPage().$('tbody [data-slot="badge"]=Handler error')).toBeExisting();

    // Each message arrives as its own MSK event, with the key base64-encoded the way AWS sends it.
    expect(sam.events.map(recordKeys).sort()).toEqual([["fail-2"], ["order-1"]]);
    expect(sam.events.every((e) => JSON.stringify(e).includes(`"${topic}-`))).toBe(true);

    await actionPage().$("td=order-1").click();
    await expect(actionPage().$('pre*="handled"')).toBeExisting();
    await actionPage().$("td=fail-2").click();
    await expect(actionPage().$("p*=Rejected fail-2")).toBeExisting();
    await snapshot("action-history");
  });

  it("stops, keeping its history", async () => {
    await $(`button[aria-label="Stop ${name}"]`).click();
    await expect($('h1 [data-slot="badge"]=Stopped')).toBeExisting();
    await expect(actionPage().$$('tbody [data-slot="badge"]')).toBeElementsArrayOfSize(2);
    await expect($("#action-name")).toBeEnabled();
    await goTo("Actions");
  });

  it("deletes the action, then its topic", async () => {
    await $(`button=${name}`).click();
    await $(`button[aria-label="Delete ${name}"]`).click();
    await button("Delete", openAlertDialog()).click();
    await expectToast(`Deleted ${name}`);
    await expect($(`button=${name}`)).not.toBeExisting();
    await expect($("h2=Run your local code on every Kafka message")).toBeDisplayed();

    await deleteTopic(topic);
  });
});

