import { $, expect } from "@wdio/globals";

import { button, ensureCluster, expectToast, goTo, openAlertDialog, openDialog, uniqueName } from "../helpers.js";

describe("ACLs", () => {
  before(ensureCluster);

  it("creates, lists and deletes an ACL", async () => {
    const principal = `User:${uniqueName("e2e")}`;
    await goTo("ACLs");

    await button("New ACL").click();
    await $("#acl-principal").clearValue();
    await $("#acl-principal").setValue(principal);
    await $("#acl-resource-name").setValue("demo.");
    await button("Create", openDialog()).click();
    await expectToast(`Added ACL for ${principal}`);

    const row = $(`//tr[td[normalize-space()="${principal}"]]`);
    await expect(row).toHaveText(expect.stringContaining("Read"));
    await expect(row).toHaveText(expect.stringContaining("demo."));

    await row.$(`button[aria-label="Delete ACL for ${principal}"]`).click();
    await button("Delete", openAlertDialog()).click();
    await expectToast(`Deleted ACL for ${principal}`);
    await expect(row).not.toBeExisting();
  });
});
