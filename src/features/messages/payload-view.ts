import { prettyJson } from "@/lib/format";

import type { Payload } from "./types";

/** How the message panel shows a payload's bytes. */
export type PayloadView = "text" | "hex" | "base64";

/** The views a payload can be shown in; text only when its bytes are UTF-8. */
export function payloadViews(payload: Payload): PayloadView[] {
  return payload.encoding === "utf8" ? ["text", "hex", "base64"] : ["hex", "base64"];
}

/** `payload` rendered as `view`, falling back to hex when text isn't possible. */
export function renderPayload(payload: Payload, view: PayloadView): string {
  if (view === "text" && payload.encoding === "utf8") return prettyJson(payload.text);
  if (view === "base64") return toBase64(payloadBytes(payload));
  return payload.encoding === "hex" ? payload.text : toHex(payloadBytes(payload));
}

/** The original bytes: the backend sends UTF-8 as text, anything else as space-separated hex. */
export function payloadBytes(payload: Payload): Uint8Array {
  if (payload.encoding === "utf8") return new TextEncoder().encode(payload.text);
  const pairs = payload.text.split(" ").filter(Boolean);
  return Uint8Array.from(pairs, (pair) => parseInt(pair, 16));
}

/** Space-separated lowercase hex, the same format the backend uses for binary. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
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
