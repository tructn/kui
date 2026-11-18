import { $, $$, browser, expect } from "@wdio/globals";

import { button, ensureCluster, expectToast, goTo, openAlertDialog, openDialog, uniqueName } from "../helpers.js";

/** The e2e broker runs StandardAuthorizer with ANONYMOUS as a super user (see docker-compose.yml). */
describe("ACLs", () => {
  // A principal no other run used, so the rows below are only this run's.
  const principal = `User:${uniqueName("e2e")}`;
  const deleteButton = (operation: string) => $(`button[aria-label^="Delete ACL: Allow ${principal} to ${operation} "]`);
  const rowCount = async () => (await $$(`td=${principal}`)).length;

  before(async () => {
    await ensureCluster();
    await goTo("ACLs");
  });

  it("creates one ACL per chosen operation", async () => {
    await button("New ACL").click();
    await expect(openDialog()).toBeDisplayed();
    await $("#acl-principal").clearValue();
    await $("#acl-principal").setValue(principal);
    await $("#acl-resource-name").setValue("demo.orders");
    await $("#acl-op-read").click();
    await $("#acl-op-describe").click();
    await button("Create 2 ACLs", openDialog()).click();

    await expectToast("Created 2 ACLs");
    await openDialog().waitForExist({ reverse: true });
    await $('input[aria-label="Filter ACLs"]').setValue(principal);
    await browser.waitUntil(async () => (await rowCount()) === 2, { timeoutMsg: "The 2 new ACLs were not listed" });
  });

  it("keeps the ACL when its delete dialog is cancelled", async () => {
    await deleteButton("Read").click();
    await expect(openAlertDialog()).toHaveText(expect.stringContaining(`Allow ${principal} to Read topic demo.orders`));
    await button("Cancel", openAlertDialog()).click();
    await openAlertDialog().waitForExist({ reverse: true });
    expect(await rowCount()).toBe(2);
  });

  it("deletes exactly the confirmed ACL", async () => {
    await deleteButton("Read").click();
    await button("Delete", openAlertDialog()).click();
    await expectToast("Deleted ACL");
    await browser.waitUntil(async () => (await rowCount()) === 1, { timeoutMsg: "The deleted ACL is still listed" });
    // Its sibling differs only in the operation and must survive.
    await expect(deleteButton("Describe")).toBeExisting();

    await deleteButton("Describe").click();
    await button("Delete", openAlertDialog()).click();
    await browser.waitUntil(async () => (await rowCount()) === 0, { timeoutMsg: "The last ACL is still listed" });
  });

  it("offers only the operations that apply to the chosen resource type", async () => {
    await button("New ACL").click();
    await $("#acl-principal").clearValue();
    await $("#acl-principal").setValue(principal);
    await $("#acl-resource-type").click();
    await $('[role="option"]=Group').click();
    // Write applies to topics but never to a group.
    await expect($("#acl-op-write")).not.toBeExisting();
    await $("#acl-resource-name").setValue("demo-billing");
    await $("#acl-op-read").click();
    await button("Create", openDialog()).click();
    await expectToast("Created ACL");
    await openDialog().waitForExist({ reverse: true });

    await browser.waitUntil(async () => (await rowCount()) === 1, { timeoutMsg: "The group ACL was not listed" });
    await expect($("span=demo-billing")).toBeExisting();
    await deleteButton("Read").click();
    await button("Delete", openAlertDialog()).click();
    await browser.waitUntil(async () => (await rowCount()) === 0, { timeoutMsg: "The group ACL is still listed" });
  });
});
