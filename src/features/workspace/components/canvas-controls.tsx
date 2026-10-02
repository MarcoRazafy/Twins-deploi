"use client";

import {
  Grid3x3,
  Magnet,
  Maximize,
  Minus,
  Plus,
  Redo2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { motion, useTransform } from "motion/react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHotkeyLabel } from "@/hooks/use-hotkey";
import { cn } from "@/lib/utils";

import type { CanvasEngine } from "../lib/canvas-engine";

function ShortcutKeys({ combo }: { combo: string }) {
  const keys = useHotkeyLabel(combo);
  return (
    <KbdGroup>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

interface ControlButtonProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Toggle state: exposes aria-pressed and tints the icon. */
  pressed?: boolean;
}

function ControlButton({ icon: Icon, label, shortcut, onClick, disabled, pressed }: ControlButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          className={cn("size-9 rounded-none", pressed && "text-brand-400")}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}
        {shortcut ? <ShortcutKeys combo={shortcut} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}

function ControlGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-card shadow-lg shadow-black/30">
      {children}
    </div>
  );
}

export interface CanvasControlsProps {
  engine: CanvasEngine;
  showGrid: boolean;
  snapToGrid: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFit: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

/** Vertical control stack, bottom left (grid, zoom, fit, history). */
export function CanvasControls({
  engine,
  showGrid,
  snapToGrid,
  canUndo,
  canRedo,
  onToggleGrid,
  onToggleSnap,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFit,
  onUndo,
  onRedo,
}: CanvasControlsProps) {
  const zoomLabel = useTransform(engine.zoom, (zoom) => `${Math.round(zoom * 100)} %`);

  return (
    <div
      className="absolute bottom-3 left-3 z-30 flex flex-col gap-2"
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Contrôles du canvas"
    >
      <ControlGroup>
        <ControlButton
          icon={Grid3x3}
          label={showGrid ? "Masquer la grille" : "Afficher la grille"}
          onClick={onToggleGrid}
          pressed={showGrid}
        />
        <Separator />
        <ControlButton
          icon={Magnet}
          label={snapToGrid ? "Désactiver l’aimantation" : "Activer l’aimantation"}
          onClick={onToggleSnap}
          pressed={snapToGrid}
        />
      </ControlGroup>

      <ControlGroup>
        <ControlButton icon={Plus} label="Zoom avant" shortcut="+" onClick={onZoomIn} />
        <Separator />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              aria-label="Réinitialiser le zoom à 100 %"
              onClick={onResetZoom}
              className="tabular h-7 w-9 rounded-none px-0 text-[11px] text-muted-foreground"
            >
              <motion.span>{zoomLabel}</motion.span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Réinitialiser le zoom</TooltipContent>
        </Tooltip>
        <Separator />
        <ControlButton icon={Minus} label="Zoom arrière" shortcut="-" onClick={onZoomOut} />
        <Separator />
        <ControlButton icon={Maximize} label="Ajuster à l’écran" shortcut="0" onClick={onFit} />
      </ControlGroup>

      <ControlGroup>
        <ControlButton
          icon={Undo2}
          label="Annuler le déplacement"
          shortcut="mod+z"
          onClick={onUndo}
          disabled={!canUndo}
        />
        <Separator />
        <ControlButton
          icon={Redo2}
          label="Rétablir le déplacement"
          shortcut="mod+shift+z"
          onClick={onRedo}
          disabled={!canRedo}
        />
      </ControlGroup>
    </div>
  );
}
