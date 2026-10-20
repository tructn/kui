import { $, $$, browser, expect } from "@wdio/globals";

import { button, ensureCluster, goTo, openSheet, snapshot } from "../helpers.js";

describe("Consumer groups", () => {
  before(ensureCluster);

  it("lists the seeded group with its topic and remaining messages", async () => {
    await goTo("Consumer groups");
    const row = $("td=demo-billing").parentElement();
    // Remaining (lag) arrives after the list, from a separate request.
    await expect(row).toHaveText(expect.stringContaining("20"));
    await snapshot("consumer-groups");
    // WebKit's getText skips text inside overflow-hidden badges, so look for the element.
    await expect(row.$("span=demo.orders")).toBeExisting();
  });

  it("shows how far the group read each partition", async () => {
    await $("td=demo-billing").click();

    // The seed consumed 30 of 50 messages.
    await expect(openSheet()).toHaveText(expect.stringContaining("Remaining 20"));
    await expect(openSheet()).toHaveText(expect.stringContaining("Consumed 30"));
    await expect(openSheet().$("span=demo.orders")).toBeDisplayed();
    // A single topic opens expanded, one row per partition.
    await expect(openSheet().$$("tbody tr")).toBeElementsArrayOfSize({ gte: 3 });
    await browser.keys("Escape");
  });

  it("lists the group on the topic's Consumers tab", async () => {
    await goTo("Topics");
    await $("span=demo.orders").click();
    await button("Consumers").click();
    const panel = $('[role="tabpanel"][data-state="active"]');
    // Other groups may read the topic too, so sections start collapsed: expand demo-billing's.
    const section = panel.$("span=demo-billing").parentElement();
    await expect(section).toBeExisting();
    await section.click();
    await expect(section.parentElement().parentElement().parentElement().$$("tbody tr")).toBeElementsArrayOfSize(3);
  });
});
