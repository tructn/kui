// A throwaway REST API for trying KUI's HTTP request action against `demo.orders`.
// No dependencies: `bun server.ts` or `docker compose up -d`.

type Status = "NEW" | "PAID" | "SHIPPED";
type Decision = "charge" | "ship" | "done";

interface Order {
  orderId: string;
  customer: string;
  total: number;
  status: Status;
}

interface Processed extends Order {
  decision: Decision;
  processedAt: string;
}

const PORT = Number(process.env.PORT ?? 8080);
const DEMO_TOKEN = process.env.DEMO_TOKEN ?? "kui-demo-token";
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_HISTORY = 500;
const MAX_DELAY_MS = 120_000;
// Same cut-off as the .NET example, so the seeded topic produces a few failures.
const FAIL_ABOVE_TOTAL = 450;

const DECISIONS: Record<Status, Decision> = { NEW: "charge", PAID: "ship", SHIPPED: "done" };

const processed = new Map<string, Processed>();
const requests: { at: string; method: string; path: string; status: number }[] = [];
let flakyCalls = 0;

const json = (status: number, body: unknown) => Response.json(body, { status });

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isOrder = (v: unknown): v is Order =>
  isRecord(v) &&
  typeof v.orderId === "string" &&
  typeof v.customer === "string" &&
  typeof v.total === "number" &&
  typeof v.status === "string" &&
  v.status in DECISIONS;

// The action can post either the raw message value or a JSON envelope with the value under `value`
// (as a string or already parsed), so accept both.
function unwrapOrder(body: unknown): unknown {
  if (!isRecord(body) || !("value" in body)) return body;
  if (typeof body.value !== "string") return body.value;
  try {
    return JSON.parse(body.value);
  } catch {
    return body.value;
  }
}

async function readBody(req: Request): Promise<{ text: string; parsed: unknown }> {
  const text = await req.text();
  try {
    return { text, parsed: JSON.parse(text) };
  } catch {
    return { text, parsed: undefined };
  }
}

async function processOrder(req: Request): Promise<Response> {
  const { parsed } = await readBody(req);
  const order = unwrapOrder(parsed);
  if (!isOrder(order)) {
    return json(400, { error: "expected an order: { orderId, customer, total, status: NEW | PAID | SHIPPED }" });
  }
  if (order.total > FAIL_ABOVE_TOTAL) {
    return json(500, { error: `order ${order.orderId} total ${order.total} exceeds ${FAIL_ABOVE_TOTAL}` });
  }
  const result: Processed = { ...order, decision: DECISIONS[order.status], processedAt: new Date().toISOString() };
  processed.delete(order.orderId);
  processed.set(order.orderId, result);
  if (processed.size > MAX_HISTORY) {
    const oldest = processed.keys().next().value;
    if (oldest !== undefined) processed.delete(oldest);
  }
  return json(200, result);
}

async function echo(req: Request, url: URL): Promise<Response> {
  const { text, parsed } = await readBody(req);
  return json(200, {
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries(req.headers),
    body: parsed ?? text,
    receivedAt: new Date().toISOString(),
  });
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname: path } = url;
  const method = req.method;

  if (path === "/health" && method === "GET") return json(200, { status: "ok" });

  if (path === "/webhook") return echo(req, url);

  if (path === "/orders") {
    if (method === "POST") return processOrder(req);
    if (method === "GET") return json(200, [...processed.values()].reverse());
    if (method === "DELETE") {
      processed.clear();
      return new Response(null, { status: 204 });
    }
  }

  const orderMatch = path.match(/^\/orders\/([^/]+)$/);
  if (orderMatch && method === "GET") {
    const order = processed.get(decodeURIComponent(orderMatch[1] ?? ""));
    return order ? json(200, order) : json(404, { error: "order not processed yet" });
  }

  if (path === "/secure/webhook") {
    if (req.headers.get("authorization") !== `Bearer ${DEMO_TOKEN}`) {
      return json(401, { error: "missing or wrong bearer token" });
    }
    return echo(req, url);
  }

  const statusMatch = path.match(/^\/status\/(\d{3})$/);
  if (statusMatch) {
    const code = Number(statusMatch[1]);
    if (code < 200 || code > 599) return json(400, { error: "status must be 200-599" });
    return code === 204 ? new Response(null, { status: 204 }) : json(code, { status: code });
  }

  if (path === "/slow") {
    const ms = Math.min(Math.max(Number(url.searchParams.get("ms") ?? 5000) || 0, 0), MAX_DELAY_MS);
    await Bun.sleep(ms);
    return echo(req, url);
  }

  if (path === "/flaky") {
    flakyCalls += 1;
    if (flakyCalls % 2 === 1) return json(503, { error: "temporarily unavailable, try again", call: flakyCalls });
    return echo(req, url);
  }

  if (path === "/requests" && method === "GET") return json(200, requests.slice().reverse());

  return json(404, { error: `no route for ${method} ${path}` });
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  maxRequestBodySize: MAX_BODY_BYTES,
  // `/slow` can outlast Bun's 10 s default idle timeout.
  idleTimeout: 0,
  async fetch(req) {
    const res = await route(req);
    const path = new URL(req.url).pathname;
    if (path !== "/requests" && path !== "/health") {
      requests.push({ at: new Date().toISOString(), method: req.method, path, status: res.status });
      if (requests.length > MAX_HISTORY) requests.shift();
    }
    console.log(`${req.method} ${path} -> ${res.status}`);
    return res;
  },
});

console.log(`order-api listening on http://localhost:${server.port}`);
