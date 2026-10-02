"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { CommandPalette } from "@/components/layout/command-palette";
import { ResetDemoDialog } from "@/components/layout/reset-demo-dialog";
import { useSidebarPrefs } from "@/components/layout/sidebar-prefs";
import { Topbar } from "@/components/layout/topbar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SessionGate } from "@/features/auth";

const SHELL_STYLE = { "--sidebar-width": "15rem" } as CSSProperties;

/**
 * Chrome around every platform screen: sidebar, top bar and one scrolling
 * <main>. The window never scrolls; a page that needs the full height (the
 * workspace) simply uses `h-full` inside <main>.
 */
function PlatformChrome({ children }: { children: ReactNode }) {
  const sidebarOpen = useSidebarPrefs((state) => state.open);
  const setSidebarOpen = useSidebarPrefs((state) => state.setOpen);
  // One confirmation dialog, opened from the user menu and the command palette.
  const [resetOpen, setResetOpen] = useState(false);
  const requestReset = () => setResetOpen(true);

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      style={SHELL_STYLE}
      className="h-dvh min-h-0 overflow-hidden"
    >
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-xl shadow-black/40 ring-2 ring-ring outline-none focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Aller au contenu
      </a>

      <AppSidebar onResetDemo={requestReset} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main
          id="main-content"
          tabIndex={-1}
          className="relative min-h-0 flex-1 overflow-y-auto outline-none"
        >
          {children}
        </main>
      </div>

      <CommandPalette onResetDemo={requestReset} />
      <ResetDemoDialog open={resetOpen} onOpenChange={setResetOpen} />
    </SidebarProvider>
  );
}

/**
 * Every platform route renders behind the session gate. Against the simulator
 * the gate is a pass-through, so nothing changes there.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SessionGate>
      <PlatformChrome>{children}</PlatformChrome>
    </SessionGate>
  );
}
