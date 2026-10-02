import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { STORAGE_KEYS } from "@/lib/constants";

export interface UiState {
  /** Command palette visibility (mod+K, or the search button of the top bar). */
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  /**
   * Last project whose workspace was opened: where `/workspace` sends the
   * user. The workspace feature writes it; `null` means none yet.
   */
  lastProjectId: string | null;
  setLastProjectId: (id: string | null) => void;
}

/**
 * Cross-screen UI state. Only `lastProjectId` survives a reload.
 *
 * SSR: the pages stay static, so nothing is read on the server. Zustand's
 * React hook serves the initial (unpersisted) state while hydrating and the
 * stored value right after, so rendering `lastProjectId` cannot cause a
 * hydration mismatch. Outside React (effects, handlers) use
 * `useUiStore.getState()`: it already holds the persisted value.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      commandOpen: false,
      setCommandOpen: (open) => set({ commandOpen: open }),
      lastProjectId: null,
      setLastProjectId: (id) =>
        set((state) => (state.lastProjectId === id ? state : { lastProjectId: id })),
    }),
    {
      name: STORAGE_KEYS.ui,
      version: 1,
      // The getter throws on the server (no localStorage): zustand then skips persistence.
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ lastProjectId: state.lastProjectId }),
    },
  ),
);
