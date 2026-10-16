import { prettyJson, prettyXml } from "@/lib/format";

import type { Payload, PayloadFormat } from "./types";

/** How the message panel shows a payload's bytes. */
export type PayloadView = "text" | "hex" | "base64";

export const FORMAT_LABELS: Record<PayloadFormat, string> = {
  json: "JSON",
  xml: "XML",
  text: "Text",
  avro: "Avro",
  protobuf: "Protobuf",
  jsonSchema: "JSON Schema",
  msgpack: "MessagePack",
  binary: "Binary",
};

/** The views a payload can be shown in; text only when it's readable as is or was decoded. */
export function payloadViews(payload: Payload): PayloadView[] {
  return readable(payload) ? ["text", "hex", "base64"] : ["hex", "base64"];
}

/** What the "text" view is called: decoded formats show JSON, not their bytes. */
export function textViewLabel(payload: Payload): string {
  return payload.decoded != null ? "Decoded" : "Text";
}

/** `payload` rendered as `view`, falling back to hex when text isn't possible. */
export function renderPayload(payload: Payload, view: PayloadView): string {
  if (view === "text" && readable(payload)) {
    if (payload.decoded != null) return prettyJson(payload.decoded);
    if (payload.format === "json") return prettyJson(payload.text);
    if (payload.format === "xml") return prettyXml(payload.text);
    return payload.text;
  }
  if (view === "base64") return toBase64(payloadBytes(payload));
  return payload.encoding === "hex" ? payload.text : toHex(payloadBytes(payload));
}

/** One line for the message table: the decoded JSON when there is one, else the bytes as shown. */
export function payloadPreview(payload: Payload): string {
  return payload.decoded ?? payload.text;
}

function readable(payload: Payload): boolean {
  return payload.encoding === "utf8" || payload.decoded != null;
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
