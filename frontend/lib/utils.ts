import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// `text-code` is a font size from index.css; without this, twMerge would read it as a color.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["code"] } } });

/** Joins class names, letting later Tailwind classes override earlier conflicting ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
