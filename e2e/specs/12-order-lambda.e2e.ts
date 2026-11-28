import { $, browser, expect } from "@wdio/globals";

import {
  button,
  createTopic,
  deleteTopic,
  ensureCluster,
  expectToast,
  goTo,
  openAlertDialog,
  openSheet,
  produceMessages,
  snapshot,
  uniqueName,
} from "../helpers.js";
import { startOrderLambda, type OrderLambda } from "../order-lambda.js";

/**
 * Actions against the real examples/order-lambda: messages produced in KUI run the .NET handler through the
 * AWS Lambda Test Tool, set up with the editor's defaults (Test Tool, MSK event, debug mode).
 */
describe("Actions with the .NET order Lambda", () => {
  const topic = uniqueName("e2e.orders");
  const name = uniqueName("Dotnet orders");
  const charged = { key: "order-1", value: '{"orderId":"e2e-1","customer":"cust-1","total":120,"status":"NEW"}' };
  // The handler refuses orders over 450.
  const refused = { key: "order-2", value: '{"orderId":"e2e-2","customer":"cust-2","total":999,"status":"PAID"}' };
  let lambda: OrderLambda;

  before(async () => {
    lambda = await startOrderLambda();
    await ensureCluster();
  });

  after(async () => {
    await lambda.close();
  });

  it("sets up an action on an empty topic with the Test Tool defaults", async () => {
    await createTopic(topic);

    await goTo("Actions");
    // The Actions spec before this one deletes its action, but don't depend on it.
    if (await $("button*=New action").isExisting()) {
      await $("button*=New action").click();
      await $('[role="menuitem"]*=AWS Lambda').click();
    } else {
      await $("button*=AWS Lambda").click();
    }
    await expect(openSheet()).toBeDisplayed();

    await $("#action-name").setValue(name);
    await $("#action-topic").click();
    await $(`[role="option"]*=${topic}`).click();
    await openSheet().$('button[role="radio"]*=The whole topic').click();

    await expect($("#action-endpoint")).toHaveValue(lambda.endpoint);
    await expect($("#action-endpoint-status")).toHaveText(expect.stringContaining("The Lambda Test Tool is running"));
    await $("#action-function").setValue(lambda.functionName);
    await expect($("#action-debug")).toHaveAttribute("aria-checked", "true");

    await button("Save and start", openSheet()).click();
    await expectToast(`${name} is running`);
    await openSheet().waitForExist({ reverse: true });
  });

  it("runs the function for each message produced in KUI", async () => {
    await goTo("Topics");
    await $(`span=${topic}`).click();
    await expect($(`h1*=${topic}`)).toBeDisplayed();
    await produceMessages([charged, refused]);

    await goTo("Actions");
    await button(name).click();
    await expect(openSheet()).toBeDisplayed();
    // Debug mode runs one message at a time, and the first invocation also warms up the .NET runtime.
    await browser.waitUntil(async () => (await openSheet().$$('tbody [data-slot="badge"]').length) === 2, {
      timeout: 60_000,
      timeoutMsg: "The history did not show both executions",
    });
    await expect(openSheet().$('tbody [data-slot="badge"]=Succeeded')).toBeExisting();
    await expect(openSheet().$('tbody [data-slot="badge"]=Function error')).toBeExisting();

    // HandleMsk logs every record it reads, so this proves the .NET code itself got both messages.
    expect(lambda.output()).toContain(`${topic}[`);
    expect(lambda.output()).toContain('"orderId":"e2e-1"');
    expect(lambda.output()).toContain('"orderId":"e2e-2"');

    await openSheet().$(`td=${charged.key}`).click();
    await expect(openSheet().$('pre*="charge"')).toBeExisting();
    await openSheet().$(`td=${refused.key}`).click();
    await expect(openSheet().$("p*=over the 450 review limit")).toBeExisting();
    await snapshot("dotnet-lambda-history");
  });

  it("stops and cleans up", async () => {
    await openSheet().$(`button[aria-label="Stop ${name}"]`).click();
    await expect(openSheet().$('[data-slot="sheet-header"] [data-slot="badge"]=Stopped')).toBeExisting();
    await browser.keys("Escape");
    await openSheet().waitForExist({ reverse: true });

    await $(`button[aria-label="More for ${name}"]`).click();
    await $('[role="menuitem"]*=Delete').click();
    await button("Delete", openAlertDialog()).click();
    await expectToast(`Deleted ${name}`);

    await deleteTopic(topic);
  });
});
