"use client";

import { useEffect, useEffectEvent, useMemo, useSyncExternalStore } from "react";

export interface HotkeyOptions {
  /** Set to false to detach the listener (default true). */
  enabled?: boolean;
  /**
   * Also fire while the user types in an input, textarea, select or
   * contenteditable element (default false).
   */
  allowInInputs?: boolean;
  /** Fire repeatedly while the key is held down (default false). */
  allowRepeat?: boolean;
  /** Call `preventDefault()` when the hotkey matches (default true). */
  preventDefault?: boolean;
}

interface ParsedCombo {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  space: " ",
  spacebar: " ",
  return: "enter",
  del: "delete",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  plus: "+",
};

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function parseCombo(combo: string): ParsedCombo | null {
  const normalized = combo.trim().toLowerCase();
  if (!normalized) return null;

  // "+" is both the separator and a key: "+" and "mod++" target the plus key.
  let parts: string[];
  if (normalized === "+") parts = ["+"];
  else if (normalized.endsWith("++")) parts = [...normalized.slice(0, -2).split("+"), "+"];
  else parts = normalized.split("+");

  const key = parts[parts.length - 1].trim();
  if (!key) return null;
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.trim()));

  return {
    key: KEY_ALIASES[key] ?? key,
    mod: modifiers.has("mod"),
    ctrl: modifiers.has("ctrl") || modifiers.has("control"),
    meta: modifiers.has("meta") || modifiers.has("cmd") || modifiers.has("command"),
    alt: modifiers.has("alt") || modifiers.has("option"),
    shift: modifiers.has("shift"),
  };
}

function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function matches(event: KeyboardEvent, combo: ParsedCombo): boolean {
  if (event.key.toLowerCase() !== combo.key) return false;

  const apple = isApplePlatform();
  const wantCtrl = combo.ctrl || (combo.mod && !apple);
  const wantMeta = combo.meta || (combo.mod && apple);
  // AltGr is reported as Ctrl+Alt on Windows; it is how several layouts type
  // symbols, so it must not count as a modifier.
  const altGraph = event.getModifierState("AltGraph");
  const ctrl = event.ctrlKey && !altGraph;
  const alt = event.altKey && !altGraph;
  if (ctrl !== wantCtrl || event.metaKey !== wantMeta || alt !== combo.alt) return false;

  if (combo.shift) return event.shiftKey;
  // Symbols and digits need Shift on many layouts ("/" on AZERTY): only
  // letters and named keys treat an unexpected Shift as a different shortcut.
  const shiftSensitive = combo.key.length > 1 || /^[a-z]$/.test(combo.key);
  return !(shiftSensitive && event.shiftKey);
}

/**
 * Global keyboard shortcut.
 *
 *   useHotkey("mod+k", openPalette);            // ⌘K on macOS, Ctrl+K elsewhere
 *   useHotkey("/", focusSearch);
 *   useHotkey("escape", close, { enabled: open, allowInInputs: true });
 *
 * Combos are `modifier+…+key` with the modifiers `mod`, `ctrl`, `meta`, `alt`
 * and `shift`; the key is a `KeyboardEvent.key` value (case-insensitive).
 * Events another handler already consumed (`defaultPrevented`, e.g. Escape
 * closing a dialog) are ignored, so shortcuts never fire twice.
 */
export function useHotkey(
  combo: string,
  handler: (event: KeyboardEvent) => void,
  options: HotkeyOptions = {},
): void {
  const {
    enabled = true,
    allowInInputs = false,
    allowRepeat = false,
    preventDefault = true,
  } = options;
  const parsed = useMemo(() => parseCombo(combo), [combo]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!parsed || event.defaultPrevented || event.isComposing) return;
    if (event.repeat && !allowRepeat) return;
    if (!matches(event, parsed)) return;
    if (!allowInInputs && isEditableTarget(event.target)) return;
    if (preventDefault) event.preventDefault();
    handler(event);
  });

  useEffect(() => {
    if (!enabled) return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [enabled]);
}

const KEY_LABELS: Record<string, string> = {
  escape: "Échap",
  enter: "Entrée",
  " ": "Espace",
  delete: "Suppr",
  backspace: "Retour",
  tab: "Tab",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

/**
 * Keys to display for a combo, one entry per `<Kbd>`:
 * `formatHotkey("mod+k", true)` → `["⌘", "K"]`, `false` → `["Ctrl", "K"]`.
 */
export function formatHotkey(combo: string, apple = false): string[] {
  const parsed = parseCombo(combo);
  if (!parsed) return [];

  const keys: string[] = [];
  if (parsed.ctrl || (parsed.mod && !apple)) keys.push("Ctrl");
  if (parsed.meta || (parsed.mod && apple)) keys.push("⌘");
  if (parsed.alt) keys.push(apple ? "⌥" : "Alt");
  if (parsed.shift) keys.push(apple ? "⇧" : "Maj");
  keys.push(
    KEY_LABELS[parsed.key] ??
      (parsed.key.length === 1
        ? parsed.key.toUpperCase()
        : parsed.key.charAt(0).toUpperCase() + parsed.key.slice(1)),
  );
  return keys;
}

function subscribeNever() {
  return () => {};
}

/**
 * Display keys of a combo for the current platform. Renders the non-Apple
 * form on the server and during hydration, then corrects itself on macOS.
 */
export function useHotkeyLabel(combo: string): string[] {
  const apple = useSyncExternalStore(subscribeNever, isApplePlatform, () => false);
  return useMemo(() => formatHotkey(combo, apple), [combo, apple]);
}
