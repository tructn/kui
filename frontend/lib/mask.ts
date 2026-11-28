const FAKE_HOSTS = [
  "ねこ.local",
  "侘び寂び.internal",
  "totally-not-prod.invalid",
  "(╯°□°)╯︵ ┻━┻",
  "hunter2.example",
  "おにぎり-broker-1",
  "nothing-to-see.here",
  "¯\\_(ツ)_/¯",
  "宇宙.cluster",
  "ninja-mode.on",
] as const;

const FAKE_PORTS = ["1337", "42", "8008", "31337", "9001"] as const;

const FAKE_CLUSTER_NAMES = [
  "Sir Reginald Offsetworth",
  "暗号の森",
  "“It works on my machine”",
  "Captain Lag",
  "東京ラーメン",
  "“Have you tried turning it off and on?”",
  "Baron von Rebalance",
  "猫の部屋",
  "“This is fine”",
  "Duchess Partitiona",
] as const;

function pick<T>(list: readonly T[], n: number): T {
  return list[((n % list.length) + list.length) % list.length] as T;
}

// FNV-1a. A hash of the real value keeps each fake stable across renders and different
// per broker, while a few-bucket pick leaks only a few bits (never the length).
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Shown in place of a hidden address: a made-up host, unrelated to the real one's length. */
export function maskAddress(value: string, hidden: boolean): string {
  return hidden ? pick(FAKE_HOSTS, hash(value)) : value;
}

export function maskPort(port: number, hidden: boolean): string {
  return hidden ? pick(FAKE_PORTS, hash(String(port))) : String(port);
}

/**
 * Shown in place of a hidden cluster name. Picked by position so the clusters in a list
 * stay tellable apart; past the end of the list a number keeps them distinct.
 */
export function maskClusterName(name: string, index: number, hidden: boolean): string {
  if (!hidden) return name;
  const round = Math.floor(Math.max(index, 0) / FAKE_CLUSTER_NAMES.length);
  const fake = pick(FAKE_CLUSTER_NAMES, index);
  return round === 0 ? fake : `${fake} ${round + 1}`;
}
