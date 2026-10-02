"use client";

import { useEffect, useState } from "react";

import type { Size } from "../lib/canvas-engine";

/**
 * Content-box size of an element, kept in sync by a ResizeObserver. Returns a
 * callback ref (so the observer follows the element) and the size, null until
 * the first measurement.
 */
export function useElementSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState<Size | null>(null);

  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize((previous) =>
        previous && previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, size] as const;
}
