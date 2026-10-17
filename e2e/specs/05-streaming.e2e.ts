import { $, browser, expect } from "@wdio/globals";

import {
  button,
  ensureCluster,
  expectToast,
  goTo,
  openAlertDialog,
  openDialog,
  snapshot,
  uniqueName,
} from "../helpers.js";

/** Live tail and fake data. */
describe("Streaming features", () => {
  // Our own topic: other specs assert on the seeded demo topics' exact counts.
  const topic = uniqueName("e2e.stream");

  before(ensureCluster);

  it("shows new messages live", async () => {
    await goTo("Topics");
    await button("New topic").click();
    await $("#topic-name").setValue(topic);
    await button("Create", openDialog()).click();
    await expectToast(`Created ${topic}`);

    await $("#live-tail").click();
    await expect($("td*=Waiting for new messages")).toBeDisplayed();

    await button("Produce").click();
    await $("#produce-key").setValue("live-1");
    await $("#produce-value").setValue('{"live":true}');
    await button("Send", openDialog()).click();
    await expectToast("Produced to partition");
    await browser.keys("Escape");

    await expect($("td=live-1")).toBeDisplayed();
    await snapshot("live-tail");
  });

  it("generates fake data from a template, watched live", async () => {
    await button("Generate").click();
    // The preview renders sample records from the preset before anything is sent.
    await expect(openDialog().$$("pre*=orderId")).toBeElementsArrayOfSize(3);
    await $("#generate-count").clearValue();
    await $("#generate-count").setValue("200");
    await snapshot("generate-dialog");

    await button("Generate 200", openDialog()).click();
    await expectToast("Produced 200 messages");
    await browser.keys("Escape");
    await expect($('[data-testid="live-count"]')).toHaveText(expect.stringContaining("201 new"));
    await snapshot("live-tail-after-generate");
    await $("#live-tail").click();

    await button("Delete").click();
    await openAlertDialog().$('input[aria-label="Topic name"]').setValue(topic);
    await button("Delete", openAlertDialog()).click();
    // Deleting returns to the topic list (a stacked toast may be hidden, so check the outcome).
    await expect($("h1=Topics")).toBeDisplayed();
    await expect($(`span=${topic}`)).not.toBeExisting();
  });
});
