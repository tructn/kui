import { $, browser, expect } from "@wdio/globals";

import { button, ensureCluster, expectToast, goTo, openAlertDialog, openDialog, uniqueName } from "../helpers.js";

describe("Deleting several topics", () => {
  const prefix = uniqueName("e2e.bulk");

  before(ensureCluster);

  it("deletes every selected topic after typing the phrase", async () => {
    for (const name of [`${prefix}.a`, `${prefix}.b`]) {
      await goTo("Topics");
      await button("New topic").click();
      await $("#topic-name").setValue(name);
      await button("Create", openDialog()).click();
      await expectToast(`Created ${name}`);
    }

    await goTo("Topics");
    await $('input[placeholder="Filter topics"]').setValue(prefix);
    // The filter applies once typing pauses; select all only after it has.
    await $("p^=2 of ").waitForExist();
    await $('button[aria-label="Select all topics on this page"]').click();
    await button("Delete 2 topics").click();

    const confirm = button("Delete 2", openAlertDialog());
    await expect(confirm).toBeDisabled();
    await openAlertDialog().$('input[aria-label="Confirmation"]').setValue("delete 2 topics");
    await confirm.click();

    await expectToast("Deleted 2 topics");
    await browser.waitUntil(async () => !(await $(`span=${prefix}.a`).isExisting()), {
      timeoutMsg: "Deleted topics are still listed",
    });
    await expect($(`span=${prefix}.b`)).not.toBeExisting();
  });
});
