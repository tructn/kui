import { $, browser, expect } from "@wdio/globals";

import { addCluster, button, CLUSTER_NAME, HOME_PAGE, KAFKA_BOOTSTRAP, openDialog } from "../helpers.js";

describe("Clusters", () => {
  it("shows the welcome screen on first launch", async () => {
    await expect($("div=Connect to Kafka")).toBeDisplayed();
  });

  it("reports a failed connection test for an unreachable broker", async () => {
    await button("Add cluster").click();
    await $("#cluster-name").setValue("Nowhere");
    await $("#cluster-bootstrap").clearValue();
    await $("#cluster-bootstrap").setValue("127.0.0.1:1");
    await button("Test connection", openDialog()).click();

    await expect($('[data-slot="field-error"]')).toBeDisplayed({ wait: 30_000 });
    await browser.keys("Escape");
  });

  it("tests and saves a working connection", async () => {
    await button("Add cluster").click();
    await $("#cluster-name").setValue(CLUSTER_NAME);
    await $("#cluster-bootstrap").clearValue();
    await $("#cluster-bootstrap").setValue(KAFKA_BOOTSTRAP);

    await button("Test connection", openDialog()).click();
    await expect(openDialog().$("button*=Connected")).toBeDisplayed();

    await browser.keys("Escape");
    await addCluster(CLUSTER_NAME, KAFKA_BOOTSTRAP);

    // Saving selects the cluster and opens its home page.
    await expect($(`h1=${HOME_PAGE}`)).toBeDisplayed();
    await expect($(`span=${CLUSTER_NAME}`)).toBeDisplayed();
  });

  it("switches between light, dark and system theme", async () => {
    const isDark = () => browser.execute(() => document.documentElement.classList.contains("dark"));
    const systemDark = () => browser.execute(() => matchMedia("(prefers-color-scheme: dark)").matches);
    const theme = (label: string) => $(`button[aria-label="${label}"]`);
    await theme("Light").click();
    expect(await isDark()).toBe(false);
    await theme("Dark").click();
    expect(await isDark()).toBe(true);
    await theme("System").click();
    expect(await isDark()).toBe(await systemDark());
  });
});
