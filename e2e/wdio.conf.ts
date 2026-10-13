import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";

/**
 * Drives the real KUI binary through tauri-driver (WebDriver for Tauri).
 * tauri-driver only supports Linux and Windows, so on macOS run this via
 * Docker:  bun run test:e2e   (from the repo root)
 */
const APP = process.env.KUI_APP ?? path.resolve(import.meta.dirname, "../src-tauri/target/debug/kui");
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
    await waitForPort(DRIVER_PORT);
  },
  afterSession: () => {
    tauriDriver?.kill();
  },

  afterTest: async (test, _context, { passed }) => {
    if (passed) return;
    mkdirSync(ARTIFACTS, { recursive: true });
    const name = `${test.parent} - ${test.title}`.replace(/[^a-z0-9-]+/gi, "_");
    await browser.saveScreenshot(path.join(ARTIFACTS, `${name}.png`));
  },
};

function waitForPort(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        if (Date.now() > deadline) reject(new Error(`tauri-driver did not start on port ${port}`));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}
