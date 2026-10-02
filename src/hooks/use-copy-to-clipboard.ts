"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The async Clipboard API needs a secure context. A self-hosted instance is
 * often reached over plain HTTP on a LAN address, so fall back to the legacy
 * selection-based copy there.
 */
function legacyCopy(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or document not focused: try the legacy path.
  }
  return legacyCopy(text);
}

/**
 * `copy(text)` resolves with whether the copy succeeded; `copied` stays true
 * for `resetAfterMs` afterwards so the UI can show a confirmation.
 */
export function useCopyToClipboard(resetAfterMs = 1600) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      const succeeded = await writeToClipboard(text);
      if (!succeeded) return false;

      if (timer.current !== null) window.clearTimeout(timer.current);
      setCopied(true);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setCopied(false);
      }, resetAfterMs);
      return true;
    },
    [resetAfterMs],
  );

  return { copied, copy };
}
