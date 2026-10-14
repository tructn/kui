import { $, browser, expect } from "@wdio/globals";

/** Kafka address as seen from the app (the e2e container reaches it as kafka:29092). */
export const KAFKA_BOOTSTRAP = process.env.KAFKA_BOOTSTRAP ?? "localhost:9092";
export const CLUSTER_NAME = "E2E Kafka";

/** A name no other test run has used, so specs never collide. */
export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

/** A button by its visible text. Pass `within` to search inside a dialog/sheet. */
export function button(text: string, within?: ChainablePromiseElement) {
  return within ? within.$(`button=${text}`) : $(`button=${text}`);
}

/** The open shadcn dialog, alert dialog or sheet. */
export const openDialog = () => $('[data-slot="dialog-content"]');
export const openAlertDialog = () => $('[data-slot="alert-dialog-content"]');
export const openSheet = () => $('[data-slot="sheet-content"]');

/** Waits for a toast containing `text`. */
export async function expectToast(text: string) {
  await browser.waitUntil(
    async () => {
      for (const toast of await $$("[data-sonner-toast]")) {
        if ((await toast.getText()).includes(text)) return true;
      }
      return false;
    },
    { timeoutMsg: `No toast containing "${text}"` },
  );
}

/** Opens a page from the sidebar. */
export async function goTo(page: "Topics" | "Consumer groups" | "Brokers") {
  await button(page).click();
  await expect($(`h1*=${page}`)).toBeDisplayed();
}

/** Saves a screenshot to e2e/artifacts for reviewing the UI by eye. */
export async function snapshot(name: string) {
  const { mkdirSync } = await import("node:fs");
  const dir = new URL("./artifacts/", import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  await browser.saveScreenshot(`${dir}${name}.png`);
}

/**
 * Makes sure the E2E cluster exists and is selected. Specs run in separate app
 * sessions that share the app's data directory, so the cluster may already exist.
 */
export async function ensureCluster() {
  // Wait for the app to render one of its two start screens before deciding.
  await browser.waitUntil(
    async () => (await $("h1=Topics").isExisting()) || (await $("button=Add cluster").isExisting()),
    { timeoutMsg: "The app showed neither the topic list nor the welcome screen" },
  );
  if (await $("h1=Topics").isExisting()) return;

  const existing = $(`button=${CLUSTER_NAME}`);
  if (await existing.isExisting()) {
    await existing.click();
  } else {
    await addCluster(CLUSTER_NAME, KAFKA_BOOTSTRAP);
  }
  await expect($("h1=Topics")).toBeDisplayed();
}

export async function addCluster(name: string, bootstrap: string) {
  // A dialog that is still fading out would intercept the click.
  await openDialog().waitForExist({ reverse: true });
  await button("Add cluster").click();
  await $("#cluster-name").setValue(name);
  await $("#cluster-bootstrap").clearValue();
  await $("#cluster-bootstrap").setValue(bootstrap);
  await button("Save", openDialog()).click();
  await expectToast(`Saved ${name}`);
}

type ChainablePromiseElement = ReturnType<typeof $>;
