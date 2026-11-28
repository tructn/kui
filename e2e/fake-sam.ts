import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** The Lambda Invoke API path that `sam local start-lambda` serves. */
const INVOKE_PATH = /^\/2015-03-31\/functions\/([^/]+)\/invocations$/;

export interface FakeSam {
  endpoint: string;
  /** Event bodies the function received, in arrival order. */
  events: unknown[];
  close: () => Promise<void>;
}

/**
 * A stand-in for `sam local start-lambda` hosting one function. Unknown functions get SAM's
 * ResourceNotFound answer, which is also how KUI recognises SAM. Records whose key starts with
 * `fail` get an unhandled function error back, the way SAM reports an exception in the handler.
 */
export async function startFakeSam(functionName: string): Promise<FakeSam> {
  const events: unknown[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const name = INVOKE_PATH.exec(req.url ?? "")?.[1];
      if (req.method !== "POST" || name !== functionName) {
        res.writeHead(404, { "Content-Type": "application/json", "x-amzn-errortype": "ResourceNotFound" });
        res.end(JSON.stringify({ Type: "User", Message: "Function not found" }));
        return;
      }
      const event: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      events.push(event);
      const keys = recordKeys(event);
      if (keys.some((k) => k.startsWith("fail"))) {
        res.writeHead(200, { "Content-Type": "application/json", "X-Amz-Function-Error": "Unhandled" });
        res.end(JSON.stringify({ errorType: "OrderRejected", errorMessage: `Rejected ${keys.join(",")}` }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ handled: keys }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    events,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** The decoded record keys of an MSK event: `{ records: { "<topic>-<partition>": [{ key }] } }`. */
export function recordKeys(event: unknown): string[] {
  if (!isObject(event) || !isObject(event.records)) return [];
  return Object.values(event.records)
    .flatMap((entries) => (Array.isArray(entries) ? entries : []))
    .flatMap((entry) => (isObject(entry) && typeof entry.key === "string" ? [entry.key] : []))
    .map((key) => Buffer.from(key, "base64").toString("utf8"));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
