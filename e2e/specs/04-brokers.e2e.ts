import { $, expect } from "@wdio/globals";

import { ensureCluster, goTo } from "../helpers.js";

describe("Brokers", () => {
  before(ensureCluster);

  it("lists the broker and cluster stats", async () => {
    await goTo("Brokers");
    await expect($("td=kafka")).toBeDisplayed();
    await expect($("td=29092")).toBeDisplayed();
  });
});
