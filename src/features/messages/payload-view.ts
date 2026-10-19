import { prettyJson } from "@/lib/format";

import type { Payload } from "./types";

/** How the message panel shows a payload's bytes. */
export type PayloadView = "json" | "base64";

/** The views a payload can be shown in; JSON (pretty-printed text) only when its bytes are UTF-8. */
export function payloadViews(payload: Payload): PayloadView[] {
  return payload.encoding === "utf8" ? ["json", "base64"] : ["base64"];
}

/** `payload` rendered as `view`, falling back to base64 when text isn't possible. */
export function renderPayload(payload: Payload, view: PayloadView): string {
  if (view === "json" && payload.encoding === "utf8") return prettyJson(payload.text);
  return toBase64(payloadBytes(payload));
}

/** The original bytes: the backend sends UTF-8 as text, anything else as space-separated hex. */
export function payloadBytes(payload: Payload): Uint8Array {
  if (payload.encoding === "utf8") return new TextEncoder().encode(payload.text);
  const pairs = payload.text.split(" ").filter(Boolean);
  return Uint8Array.from(pairs, (pair) => parseInt(pair, 16));
}

export function toBase64(bytes: Uint8Array): string {
  // btoa takes a "binary string"; build it in chunks so large payloads don't
  // overflow the argument limit of String.fromCharCode.
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
