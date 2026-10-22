import { $, browser, expect } from "@wdio/globals";

/** Kafka address as seen from the app (the e2e container reaches it as kafka:29092). */
export const KAFKA_BOOTSTRAP = process.env.KAFKA_BOOTSTRAP ?? "localhost:9092";
export const CLUSTER_NAME = "E2E Kafka";
/** The page a cluster opens on after it is selected or saved. */
export const HOME_PAGE = "Brokers";

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
  // A sheet or dialog that is still fading out covers the sidebar and would intercept the click.
  await openSheet().waitForExist({ reverse: true });
  await openDialog().waitForExist({ reverse: true });
  // Sidebar buttons also hold a shortcut hint ("Ctrl 2"), so match the label inside them.
  await $(`//*[@data-sidebar="menu-button"][.//span[normalize-space()="${page}"]]`).click();
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
  // A selected cluster opens on its home page (Brokers); a fresh app shows the welcome screen.
  await browser.waitUntil(
    async () => (await $(`h1=${HOME_PAGE}`).isExisting()) || (await $("button=Add cluster").isExisting()),
    { timeoutMsg: "The app showed neither the cluster home page nor the welcome screen" },
  );
  if (await $(`h1=${HOME_PAGE}`).isExisting()) return;

  const existing = $(`button=${CLUSTER_NAME}`);
  if (await existing.isExisting()) {
    await existing.click();
  } else {
    await addCluster(CLUSTER_NAME, KAFKA_BOOTSTRAP);
  }
  await expect($(`h1=${HOME_PAGE}`)).toBeDisplayed();
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

/**
 * Commands that change a Kafka cluster or the saved cluster connections.
 * `save_setting` (UI preferences) and read-only commands are left out.
 */
export const CHANGING_COMMANDS = [
  "save_cluster",
  "delete_cluster",
  "create_topic",
  "delete_topics",
  "produce_message",
  "copy_messages",
  "generate_records",
  "delete_consumer_group",
  "reset_consumer_group_offsets",
  "install_update",
];

declare global {
  interface Window {
    __KUI_COMMANDS__?: string[];
  }
}

/** Every command the UI has sent since launch (or the last `clearCommands`). Needs a VITE_E2E=1 build. */
export function commandsSent(): Promise<string[]> {
  return browser.execute(() => window.__KUI_COMMANDS__ ?? []);
}

export async function clearCommands() {
  await browser.execute(() => {
    window.__KUI_COMMANDS__ = [];
  });
}

/** Fails if the UI sent any command that changes the cluster or the saved connections. */
export async function expectNoChangingCommands() {
  const changing = (await commandsSent()).filter((c) => CHANGING_COMMANDS.includes(c));
  expect(changing).toEqual([]);
}

type ChainablePromiseElement = ReturnType<typeof $>;
