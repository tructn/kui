import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { waitForPort } from "./ports.js";

// Headed runs only (`make e2e-headed`): a pause after every WebDriver command so the run can be
// followed, and the file name of the last spec, whose app stays open until Enter is pressed.
const SLOWMO_MS = Math.max(0, Number(process.env.E2E_SLOWMO) || 0);
const HOLD_SPEC = process.env.E2E_HOLD_SPEC;

// Workers get the launcher's stdin, but wdio may read it too, so ask the terminal directly.
// Without one (CI, `docker compose run -T`) there is nobody to press Enter, so don't wait.
function waitForEnter(): void {
  let tty: number;
  try {
    tty = openSync("/dev/tty", "r");
  } catch {
    return;
  }
  console.log("▶ Holding the app open for the VNC viewer. Press Enter here to close it.");
  const byte = Buffer.alloc(1);
  try {
    while (readSync(tty, byte) === 1 && byte[0] !== 0x0a);
  } finally {
    closeSync(tty);
  }
}

/**
 * Drives the real KUI binary through tauri-driver (WebDriver for Tauri).
 * tauri-driver only supports Linux and Windows, so on macOS run this via
 * Docker:  bun run test:e2e   (from the repo root)
 */
const APP = process.env.KUI_APP ?? path.resolve(import.meta.dirname, "../target/debug/kui");
const ARTIFACTS = path.resolve(import.meta.dirname, "artifacts");
const DRIVER_PORT = 4444;

let tauriDriver: ChildProcess | undefined;

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  hostname: "127.0.0.1",
  port: DRIVER_PORT,
  capabilities: [
    {
      // tauri-driver speaks classic WebDriver, not WebDriver BiDi.
      "wdio:enforceWebDriverClassic": true,
      "tauri:options": { application: APP },
    } as WebdriverIO.Capabilities,
  ],
  logLevel: "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 120_000 },
  // Kafka round trips (metadata, offsets) can take a few seconds.
  waitforTimeout: 20_000,

  // A fresh driver (and app instance) per spec file keeps specs independent.
  beforeSession: async () => {
    tauriDriver = spawn("tauri-driver", ["--port", String(DRIVER_PORT)], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    await waitForPort(DRIVER_PORT, "tauri-driver");
  },
  afterSession: () => {
    tauriDriver?.kill();
  },

  afterCommand: async () => {
    if (SLOWMO_MS > 0) await sleep(SLOWMO_MS);
  },
  // Runs before the session ends, while the app window is still open.
  after: (_result, _capabilities, specs) => {
    if (HOLD_SPEC && specs.some((spec) => path.basename(spec) === HOLD_SPEC)) waitForEnter();
  },

  afterTest: async (test, _context, { passed }) => {
    if (passed) return;
    mkdirSync(ARTIFACTS, { recursive: true });
    const name = `${test.parent} - ${test.title}`.replace(/[^a-z0-9-]+/gi, "_");
    await browser.saveScreenshot(path.join(ARTIFACTS, `${name}.png`));
  },
};
