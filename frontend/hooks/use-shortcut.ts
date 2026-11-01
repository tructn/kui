import { useEffect, useRef } from "react";

/**
 * Runs `handler` when a key combo is pressed anywhere in the window.
 *
 * `combo` is a key (`"]"`, `"l"`) or `"mod+<key>"`, where mod is ⌘ on macOS and
 * Ctrl elsewhere. Plain keys are ignored while the user types in a field or a
 * dialog is open, so they never steal input; mod combos always apply.
 */
export function useShortcut(combo: string, handler: () => void, enabled = true) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;
    const mod = combo.startsWith("mod+");
    const key = (mod ? combo.slice(4) : combo).toLowerCase();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.key.toLowerCase() !== key) return;
      if (mod !== (event.metaKey || event.ctrlKey)) return;
      if (!mod && (isEditable(event.target) || isDialogOpen())) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [combo, enabled]);
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    // An open dropdown (Radix Select / menu) handles its own keys.
    target.closest('[role="listbox"], [role="menu"]') !== null
  );
}

function isDialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}
