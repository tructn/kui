import { $, $$, browser, expect } from "@wdio/globals";

import { button, ensureCluster, expectToast, goTo, openAlertDialog, openDialog, openSheet, snapshot, uniqueName } from "../helpers.js";

describe("Topics and messages", () => {
  const topic = uniqueName("e2e.topic");

  before(ensureCluster);

  it("lists seeded topics with message counts", async () => {
    await goTo("Topics");
    const row = $("span=demo.orders").parentElement().parentElement().parentElement();
    await expect(row).toHaveText(expect.stringContaining("50"));
    // The table fills the page, with the pager pinned to the bottom.
    await expect($('button[aria-label="Next page"]')).toBeDisplayed();
    await snapshot("topics-list");
  });

  it("creates a topic and opens it", async () => {
    await button("New topic").click();
    await $("#topic-name").setValue(topic);
    await $("#topic-partitions").clearValue();
    await $("#topic-partitions").setValue("3");
    await button("Create", openDialog()).click();

    await expectToast(`Created ${topic}`);
    await expect($(`h1*=${topic}`)).toBeDisplayed();
  });

  it("produces a message and reads it back", async () => {
    await button("Produce").click();
    await $("#produce-key").setValue("order-42");
    await $("#produce-value").setValue('{"hello":"e2e","n":42}');
    await $("#produce-headers").setValue("source=e2e");
    await button("Send", openDialog()).click();
    await expectToast("Produced to partition");
    await browser.keys("Escape");

    // Producing refreshes the message list automatically.
    const cell = $("td=order-42");
    await expect(cell).toBeDisplayed();

    await cell.click();
    await expect(openSheet().$("pre")).toHaveText(expect.stringContaining('"hello": "e2e"'));
    await button("Headers (1)", openSheet()).click();
    // WebKit's getText skips the truncated (overflow-hidden) key, so look for the element.
    await expect(openSheet().$("span=source")).toBeExisting();
    await browser.keys("Escape");
  });

  it("shows partitions and configuration", async () => {
    await button("Partitions").click();
    await expect($$('[role="tabpanel"][data-state="active"] tbody tr')).toBeElementsArrayOfSize(3);
    await snapshot("partitions-tab");

    await button("Configuration").click();
    await expect($("td=retention.ms")).toBeDisplayed();
  });

  it("deletes the topic after typing its name", async () => {
    await button("Delete").click();
    const confirm = button("Delete", openAlertDialog());
    await expect(confirm).toBeDisabled();

    await openAlertDialog().$('input[aria-label="Topic name"]').setValue(topic);
    await confirm.click();

    // Deleting returns to the topic list (a stacked toast may be hidden, so check the outcome).
    await expect($("h1=Topics")).toBeDisplayed();
    await expect($(`span=${topic}`)).not.toBeExisting();
  });
});
