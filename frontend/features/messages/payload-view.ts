import { formatBytes, prettyJson } from "@/lib/format";

import { parseTree } from "./json-tree";
import type { Payload } from "./types";

/** How the message panel shows a payload's bytes. */
export type PayloadView = "tree" | "json" | "base64";

/**
 * The views a payload can be shown in. JSON (pretty-printed text) needs UTF-8 bytes; the tree also
 * needs that text to be a JSON object or array, or a string holding one, and a complete payload.
 */
export function payloadViews(payload: Payload): PayloadView[] {
  if (payload.encoding !== "utf8") return ["base64"];
  // A cut-off prefix is not the document, so a tree of it would pass as the real structure.
  if (payload.truncated) return ["json", "base64"];
  return parseTree(payload.text) ? ["json", "tree", "base64"] : ["json", "base64"];
}

/** `payload` rendered as `view`, falling back to base64 when text isn't possible. The tree is drawn from the text. */
export function renderPayload(payload: Payload, view: PayloadView): string {
  if (view !== "base64" && payload.encoding === "utf8") return prettyJson(payload.text);
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

/** "Truncated: showing N of M bytes" for a payload whose text is only a prefix, else null. */
export function truncationNotice(payload: Payload): string | null {
  if (!payload.truncated) return null;
  return `Truncated: showing ${formatBytes(payloadBytes(payload).length)} of ${formatBytes(payload.size)}`;
}
