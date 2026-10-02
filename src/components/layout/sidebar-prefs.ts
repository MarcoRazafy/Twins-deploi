import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { STORAGE_KEYS } from "@/lib/constants";

interface SidebarPrefs {
  /** Desktop sidebar: expanded (true) or collapsed to icons (false). */
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * Remembers the collapsed state of the sidebar in the browser. The shadcn
 * provider writes a cookie that only a server could read; the pages are
 * static, so the preference lives in localStorage instead and applies right
 * after hydration (the hook serves the default while hydrating).
 */
export const useSidebarPrefs = create<SidebarPrefs>()(
  persist(
    (set) => ({
      open: true,
      setOpen: (open) => set({ open }),
    }),
    {
      name: `${STORAGE_KEYS.ui}:sidebar`,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ open: state.open }),
    },
  ),
);
