export const MASK = "••••••••";

/** Shown in place of a hidden address. Fixed width, so it doesn't hint at the real length. */
export function maskAddress(value: string, hidden: boolean): string {
  return hidden ? MASK : value;
}

/**
 * Shown in place of a hidden cluster name. Numbered by position so the clusters
 * in a list stay tellable apart.
 */
export function maskClusterName(name: string, index: number, hidden: boolean): string {
  return hidden ? `Cluster ${index + 1}` : name;
}
