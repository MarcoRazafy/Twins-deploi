"use client";

import { FlaskConical, Search } from "lucide-react";

import { NotificationsPopover } from "@/components/layout/notifications-popover";
import { QuickCreateMenu } from "@/components/layout/quick-create-menu";
import { TopbarBreadcrumb } from "@/components/layout/topbar-breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHotkeyLabel } from "@/hooks/use-hotkey";
import { API_MODE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

function ShortcutKeys({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <KbdGroup className={className}>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

function DemoBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          asChild
          variant="outline"
          className="hidden cursor-default gap-1 rounded-md border-border-strong px-1.5 font-normal text-muted-foreground sm:inline-flex"
        >
          <button type="button">
            <FlaskConical />
            Démo
          </button>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        Mode démo : les données sont simulées et stockées dans votre navigateur.
      </TooltipContent>
    </Tooltip>
  );
}

export function Topbar() {
  const setCommandOpen = useUiStore((state) => state.setCommandOpen);
  const searchKeys = useHotkeyLabel("mod+k");
  // The shadcn sidebar provider listens to mod+B itself.
  const sidebarKeys = useHotkeyLabel("mod+b");
  const openPalette = () => setCommandOpen(true);

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:px-4">
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger
            size="icon"
            className="shrink-0"
            aria-label="Afficher ou masquer le menu latéral"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          Menu latéral
          <ShortcutKeys keys={sidebarKeys} />
        </TooltipContent>
      </Tooltip>

      <TopbarBreadcrumb />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
          aria-label="Rechercher"
          onClick={openPalette}
        >
          <Search />
        </Button>
        <Button
          variant="outline"
          className={cn(
            "hidden w-56 justify-start gap-2 px-2.5 font-normal text-muted-foreground sm:inline-flex lg:w-64",
          )}
          aria-keyshortcuts="Control+K Meta+K"
          onClick={openPalette}
        >
          <Search />
          <span>Rechercher…</span>
          <ShortcutKeys keys={searchKeys} className="ml-auto" />
        </Button>

        <QuickCreateMenu />
        <NotificationsPopover />
        {API_MODE === "mock" ? <DemoBadge /> : null}
      </div>
    </header>
  );
}
