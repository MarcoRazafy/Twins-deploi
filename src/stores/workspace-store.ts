import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { STORAGE_KEYS } from "@/lib/constants";
import type { ID, Position } from "@/lib/types";

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

/** One undoable card move (possibly several cards: auto layout). */
export interface MoveEntry {
  before: Record<ID, Position>;
  after: Record<ID, Position>;
}

interface MoveHistory {
  undo: MoveEntry[];
  redo: MoveEntry[];
}

const MAX_HISTORY = 50;
const EMPTY_HISTORY: MoveHistory = { undo: [], redo: [] };

export interface WorkspaceState {
  /** Last viewport of each project. */
  viewports: Record<ID, CanvasViewport>;
  showGrid: boolean;
  snapToGrid: boolean;
  /** In memory only, per project. */
  history: Record<ID, MoveHistory>;
  setViewport: (projectId: ID, viewport: CanvasViewport) => void;
  setShowGrid: (value: boolean) => void;
  setSnapToGrid: (value: boolean) => void;
  pushMove: (projectId: ID, entry: MoveEntry) => void;
  /** Pops the last move and queues it for redo; null when there is nothing to undo. */
  undoMove: (projectId: ID) => MoveEntry | null;
  redoMove: (projectId: ID) => MoveEntry | null;
}

/**
 * Canvas preferences and per-project viewport. Only `viewports`, `showGrid`
 * and `snapToGrid` are persisted; the move history lives for the session.
 *
 * SSR: like the UI store, the hook serves the initial state while hydrating
 * (the canvas only renders after its data loaded on the client anyway), and
 * `getState()` already holds the stored values in effects and handlers.
 */
export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      viewports: {},
      showGrid: true,
      snapToGrid: true,
      history: {},
      setViewport: (projectId, viewport) =>
        set((state) => ({ viewports: { ...state.viewports, [projectId]: viewport } })),
      setShowGrid: (value) => set({ showGrid: value }),
      setSnapToGrid: (value) => set({ snapToGrid: value }),
      pushMove: (projectId, entry) =>
        set((state) => {
          const current = state.history[projectId] ?? EMPTY_HISTORY;
          return {
            history: {
              ...state.history,
              [projectId]: { undo: [...current.undo, entry].slice(-MAX_HISTORY), redo: [] },
            },
          };
        }),
      undoMove: (projectId) => {
        const current = get().history[projectId] ?? EMPTY_HISTORY;
        const entry = current.undo[current.undo.length - 1];
        if (!entry) return null;
        set((state) => ({
          history: {
            ...state.history,
            [projectId]: { undo: current.undo.slice(0, -1), redo: [...current.redo, entry] },
          },
        }));
        return entry;
      },
      redoMove: (projectId) => {
        const current = get().history[projectId] ?? EMPTY_HISTORY;
        const entry = current.redo[current.redo.length - 1];
        if (!entry) return null;
        set((state) => ({
          history: {
            ...state.history,
            [projectId]: { undo: [...current.undo, entry], redo: current.redo.slice(0, -1) },
          },
        }));
        return entry;
      },
    }),
    {
      name: STORAGE_KEYS.workspace,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        viewports: state.viewports,
        showGrid: state.showGrid,
        snapToGrid: state.snapToGrid,
      }),
    },
  ),
);
