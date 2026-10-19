import { $, browser, expect } from "@wdio/globals";

import { addCluster, button, CLUSTER_NAME, KAFKA_BOOTSTRAP, openDialog } from "../helpers.js";

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

    // Saving selects the cluster and opens its topic list.
    await expect($("h1=Topics")).toBeDisplayed();
    await expect($(`span=${CLUSTER_NAME}`)).toBeDisplayed();
  });

  it("toggles between dark and light theme", async () => {
    const isDark = () => browser.execute(() => document.documentElement.classList.contains("dark"));
    // The default theme follows the OS, so start from whichever is showing.
    const startedDark = await isDark();
    await button(startedDark ? "Light mode" : "Dark mode").click();
    expect(await isDark()).toBe(!startedDark);
    await button(startedDark ? "Dark mode" : "Light mode").click();
    expect(await isDark()).toBe(startedDark);
  });
});
