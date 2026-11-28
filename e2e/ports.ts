import net from "node:net";

/** Resolves once something accepts TCP connections on `port` at 127.0.0.1. */
export function waitForPort(port: number, name: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        if (Date.now() > deadline) reject(new Error(`${name} did not start on port ${port}`));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}
