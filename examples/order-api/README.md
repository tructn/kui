# HTTP order API for KUI Actions

A small REST API to try the HTTP request action ([KUI Actions](../../docs/prd/kui-actions.md), Phase 2) against
`demo.orders` from the local Kafka. It's a single Bun file with no dependencies and runs in Docker. It keeps
data in memory only, so a restart clears it.

## Run it

```bash
docker compose up -d --build     # from this folder; http://localhost:8080
docker compose logs -f           # one line per request
docker compose down
```

Without Docker: `bun server.ts` (`PORT` and `DEMO_TOKEN` env vars override the defaults).

## Endpoints

| Route | Answers | Use it to see |
|---|---|---|
| `POST /orders` | `200` with a decision, `400` for a non-order, `500` for totals over 450 | success and failure on real orders |
| `GET /orders`, `GET /orders/{id}` | processed orders, newest first / one order or `404` | what the action delivered |
| `DELETE /orders` | `204`, clears processed orders | starting over |
| `ANY /webhook` | `200`, echoes method, query, headers and body | exactly what KUI sends |
| `ANY /secure/webhook` | echo with `Authorization: Bearer kui-demo-token`, else `401` | secret headers |
| `ANY /status/{code}` | that status (200-599) | how KUI records any status |
| `ANY /slow?ms=5000` | echo after the delay (max 120 s) | request timeouts |
| `ANY /flaky` | `503` and `200` in turn | intermittent failures |
| `GET /requests` | the last 500 requests with their status | a call log |
| `GET /health` | `200` | readiness |

`POST /orders` takes the raw message value or a JSON envelope with the value under `value` (a JSON string or an
object), so both body modes work. Decisions match the [.NET Lambda example](../order-lambda):
`NEW` → `charge`, `PAID` → `ship`, `SHIPPED` → `done`. The seeded topic contains a few orders over 450, so you
also get some failures.

## Try it from KUI

1. From the repo root, start Kafka with the demo topics: `bun run kafka:up`.
2. Start this API (see above).
3. In KUI, open **Actions** → **New action**, choose the HTTP executor, set `POST http://localhost:8080/orders`
   and source topic `demo.orders`, then start it.
4. Check the results in KUI, or with `curl localhost:8080/orders`.

```bash
curl -s -XPOST localhost:8080/orders \
  -d '{"orderId":"order-1","customer":"cust-1","total":13.99,"status":"PAID"}'
# {"orderId":"order-1",...,"decision":"ship","processedAt":"..."}
```
