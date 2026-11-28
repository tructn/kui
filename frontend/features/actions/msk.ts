/**
 * The message value inside an MSK event request, decoded from base64 as UTF-8.
 * Null when the request isn't an MSK event or has no value.
 */
export function decodedMskValue(requestText: string): string | null {
  let event: unknown;
  try {
    event = JSON.parse(requestText);
  } catch {
    return null;
  }
  if (!isObject(event) || !isObject(event.records)) return null;
  const batch = Object.values(event.records)[0];
  const record: unknown = Array.isArray(batch) ? batch[0] : undefined;
  if (!isObject(record) || typeof record.value !== "string") return null;
  try {
    const bytes = Uint8Array.from(atob(record.value), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
