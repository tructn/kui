import { parseKeyValueLines } from "@/lib/key-value";

import type { ConnectOptions, ConnectTarget, PublishedConnector } from "./types";

/** The Kafka Connect dialog as typed. The password is never part of it, so it is never saved. */
export interface ConnectForm {
  url: string;
  username: string;
  namePrefix: string;
  bootstrapServers: string;
  /** Text so a half-typed number isn't lost. */
  replicationFactor: string;
  /** One `key=value` per line. */
  propertiesText: string;
}

export function defaultConnectForm(bootstrapServers: string): ConnectForm {
  return {
    url: "http://localhost:8083",
    username: "",
    namePrefix: "kui",
    bootstrapServers,
    replicationFactor: "3",
    propertiesText: "",
  };
}

/** What the backend checks; a bad replication factor becomes 0, which it reports. */
export function optionsOf(form: ConnectForm): ConnectOptions {
  const factor = Number(form.replicationFactor.trim());
  return {
    namePrefix: form.namePrefix.trim(),
    bootstrapServers: form.bootstrapServers.trim(),
    replicationFactor: Number.isInteger(factor) && factor > 0 && factor <= 32767 ? factor : 0,
    properties: Object.fromEntries(parseKeyValueLines(form.propertiesText)),
  };
}

export function targetOf(form: ConnectForm, password: string): ConnectTarget {
  const username = form.username.trim();
  return { url: form.url.trim(), username: username || null, password: username ? password : null };
}

export function publishedSummary(published: readonly PublishedConnector[]): string {
  const names = (created: boolean) => published.filter((p) => p.created === created).map((p) => p.name);
  return [
    names(true).length ? `Created ${names(true).join(", ")}` : null,
    names(false).length ? `Updated ${names(false).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(". ");
}
