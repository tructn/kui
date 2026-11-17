/** A message field that can be dragged into the message being built. */
export interface SourceField {
  /** What the user sees: `customer.name`. */
  label: string;
  /** What goes into the mapping: `value.customer.name`. */
  source: string;
}

export interface SourceGroup {
  label: string;
  fields: SourceField[];
}

const MESSAGE_FIELDS = ["value", "key", "topic", "partition", "offset", "timestamp"];

/** The fields on offer: the parts of every message, then what the sample message's value and headers hold. */
export function sourceGroups(valuePaths: string[], headerNames: string[]): SourceGroup[] {
  const groups: SourceGroup[] = [
    { label: "Message", fields: MESSAGE_FIELDS.map((name) => ({ label: name, source: name })) },
    { label: "Value", fields: valuePaths.map((path) => ({ label: path, source: `value.${path}` })) },
    { label: "Headers", fields: headerNames.map((name) => ({ label: name, source: `headers.${name}` })) },
  ];
  return groups.filter((g) => g.fields.length > 0);
}

/** A name for the field a dropped source becomes: `value.customer.name` is sent as `customer.name`, never one already used. */
export function targetNameFor(source: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = source.replace(/^(value|headers)\./, "");
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}
