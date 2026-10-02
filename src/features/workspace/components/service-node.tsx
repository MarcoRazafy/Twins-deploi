"use client";

import { HardDrive, Link2 } from "lucide-react";
import { motion } from "motion/react";
import { memo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { RelativeTime } from "@/components/shared/relative-time";
import { ServiceIcon } from "@/components/shared/service-icon";
import { StatusDot } from "@/components/shared/status-badge";
import { CANVAS } from "@/lib/constants";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { SERVICE_STATUS, TONE_CLASSES } from "@/lib/status";
import type { Position, Service } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { CanvasEngine } from "../lib/canvas-engine";
import { snap } from "../lib/geometry";

/** Pointer travel (px) below which a press is a click, not a drag. */
const DRAG_THRESHOLD = 4;

export type LinkRole = "idle" | "source" | "valid" | "target" | "invalid";

export interface ServiceNodeProps {
  service: Service;
  engine: CanvasEngine;
  selected: boolean;
  /** Progress (0-100) of the in-flight deployment, null when none. */
  progress: number | null;
  /** ISO date shown at the bottom right. */
  lastActivityAt: string;
  snapEnabled: boolean;
  linkRole: LinkRole;
  /** Entrance delay (s) of the first batch; null for a card added later (it pops in). */
  entranceDelay: number | null;
  onSelect: (id: string) => void;
  onMoveEnd: (id: string, before: Position, after: Position) => void;
  /** Keyboard move, in grid steps. */
  onNudge: (id: string, stepsX: number, stepsY: number) => void;
  onDelete: (service: Service) => void;
  onLinkStart: (id: string, clientX: number, clientY: number) => void;
  onLinkMove: (clientX: number, clientY: number) => void;
  onLinkEnd: (fromId: string, clientX: number | null, clientY: number | null) => void;
}

export function serviceSubLabel(service: Service): string {
  if (service.primaryDomain) return service.primaryDomain;
  switch (service.source.type) {
    case "docker":
      return `${service.source.image}:${service.source.tag}`;
    case "postgres":
      return `PostgreSQL ${service.source.version}`;
    case "github":
      return service.source.repo;
  }
}

export const ServiceNode = memo(function ServiceNode({
  service,
  engine,
  selected,
  progress,
  lastActivityAt,
  snapEnabled,
  linkRole,
  entranceDelay,
  onSelect,
  onMoveEnd,
  onNudge,
  onDelete,
  onLinkStart,
  onLinkMove,
  onLinkEnd,
}: ServiceNodeProps) {
  const node = engine.node(service.id, service.position);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: Position;
    moved: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [settled, setSettled] = useState(false);

  const meta = SERVICE_STATUS[service.status];
  const tone = TONE_CLASSES[meta.tone];
  const crashed = service.status === "crashed";
  const stopped = service.status === "stopped";

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: node.x.get(), y: node.y.get() },
      moved: false,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      current.moved = true;
      engine.beginDrag(service.id);
      setDragging(true);
    }
    const zoom = engine.zoom.get();
    const free = !snapEnabled || event.altKey;
    const nextX = current.origin.x + dx / zoom;
    const nextY = current.origin.y + dy / zoom;
    node.x.set(free ? nextX : snap(nextX));
    node.y.set(free ? nextY : snap(nextY));
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!current.moved) {
      if (!cancelled) onSelect(service.id);
      return;
    }
    engine.endDrag(service.id);
    setDragging(false);
    const after = { x: node.x.get(), y: node.y.get() };
    if (after.x !== service.position.x || after.y !== service.position.y) {
      onMoveEnd(service.id, service.position, after);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const steps = event.shiftKey ? 4 : 1;
    switch (event.key) {
      case "Enter":
      case " ":
        event.preventDefault();
        onSelect(service.id);
        break;
      case "ArrowLeft":
        event.preventDefault();
        onNudge(service.id, -steps, 0);
        break;
      case "ArrowRight":
        event.preventDefault();
        onNudge(service.id, steps, 0);
        break;
      case "ArrowUp":
        event.preventDefault();
        onNudge(service.id, 0, -steps);
        break;
      case "ArrowDown":
        event.preventDefault();
        onNudge(service.id, 0, steps);
        break;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        onDelete(service);
        break;
    }
  }

  function handleLinkDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onLinkStart(service.id, event.clientX, event.clientY);
  }

  function handleLinkMove(event: PointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onLinkMove(event.clientX, event.clientY);
  }

  function handleLinkUp(event: PointerEvent<HTMLButtonElement>, cancelled: boolean) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onLinkEnd(service.id, cancelled ? null : event.clientX, cancelled ? null : event.clientY);
  }

  const showProgress = progress !== null;

  return (
    <motion.div
      data-node-id={service.id}
      className="group/node absolute top-0 left-0"
      style={{
        x: node.x,
        y: node.y,
        width: CANVAS.cardWidth,
        zIndex: dragging ? 20 : selected ? 10 : 1,
      }}
    >
      <motion.div
        role="button"
        tabIndex={0}
        aria-label={`${service.name}, ${meta.label}`}
        aria-pressed={selected}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishPointer(event, false)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onKeyDown={handleKeyDown}
        initial={
          entranceDelay === null ? { opacity: 0, scale: 0.8 } : { opacity: 0, scale: 0.94 }
        }
        animate={{ opacity: 1, scale: dragging ? 1.02 : 1 }}
        exit={{ opacity: 0, scale: 0.9, transition: { duration: DURATION.fast, ease: EASE.out } }}
        transition={
          settled || entranceDelay === null
            ? SPRING.smooth
            : { duration: DURATION.base, ease: EASE.out, delay: entranceDelay }
        }
        onAnimationComplete={() => setSettled(true)}
        className={cn(
          "relative touch-none rounded-xl outline-offset-4 outline-ring select-none focus-visible:outline-2",
          dragging ? "cursor-grabbing" : "cursor-pointer",
          linkRole === "invalid" && "opacity-40",
        )}
      >
        <div
          className={cn(
            "overflow-hidden rounded-xl border bg-card transition-[border-color,box-shadow] duration-150",
            dragging && "shadow-2xl shadow-black/50",
            crashed && "border-destructive/40",
            !selected && !crashed && "group-hover/node:border-border-strong",
            linkRole === "valid" && "border-dashed border-brand-800",
            selected && "ring-brand-glow",
            linkRole === "target" && "ring-brand-glow",
            linkRole === "source" && "border-brand-800",
          )}
        >
          <div className="relative p-4" style={{ height: CANVAS.cardHeight - 2 }}>
            <div className={cn("flex h-full flex-col justify-between", stopped && "opacity-60")}>
              <div className="flex min-w-0 items-start gap-3">
                <ServiceIcon type={service.source.type} tile="md" className="shrink-0" />
                <div className="min-w-0 pt-px">
                  <p className="truncate leading-5 font-medium" title={service.name}>
                    {service.name}
                  </p>
                  <p
                    className="truncate text-xs text-muted-foreground"
                    title={serviceSubLabel(service)}
                  >
                    {serviceSubLabel(service)}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5">
                  <StatusDot tone={meta.tone} pulse={meta.pulse} />
                  <span className={cn("truncate font-medium", tone.text)}>
                    {meta.label}
                    {showProgress ? (
                      <span className="tabular"> {Math.round(progress)}&nbsp;%</span>
                    ) : null}
                  </span>
                </span>
                <RelativeTime
                  date={lastActivityAt}
                  className="shrink-0 text-muted-foreground"
                />
              </div>
            </div>
            {showProgress ? (
              <div
                className="absolute inset-x-0 bottom-0 h-0.5 bg-info/15"
                role="progressbar"
                aria-label="Progression du déploiement"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
              >
                <motion.div
                  className="h-full origin-left bg-info"
                  initial={false}
                  animate={{ scaleX: progress / 100 }}
                  transition={{ duration: DURATION.slow, ease: EASE.out }}
                />
              </div>
            ) : null}
          </div>
          {service.volume ? (
            <div
              className="flex items-center gap-2 border-t bg-secondary/40 px-4 text-xs text-muted-foreground"
              style={{ height: CANVAS.volumeHeight }}
            >
              <HardDrive className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={service.volume.name}>
                {service.volume.name}
              </span>
              <span className="tabular shrink-0">
                {service.volume.usedGb.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
                {" / "}
                {service.volume.sizeGb} Go
              </span>
            </div>
          ) : null}
        </div>
      </motion.div>

      <button
        type="button"
        tabIndex={-1}
        aria-label={`Relier ${service.name} à un autre service`}
        title="Glisser vers un autre service pour les relier"
        onPointerDown={handleLinkDown}
        onPointerMove={handleLinkMove}
        onPointerUp={(event) => handleLinkUp(event, false)}
        onPointerCancel={(event) => handleLinkUp(event, true)}
        className={cn(
          "absolute -right-3 grid size-6 cursor-crosshair touch-none place-items-center rounded-full border border-border-strong bg-card text-muted-foreground opacity-0 shadow-md shadow-black/40 transition-[opacity,background-color,color] duration-150 group-focus-within/node:opacity-100 group-hover/node:opacity-100 hover:bg-primary hover:text-primary-foreground",
          selected && "opacity-100",
        )}
        style={{ top: CANVAS.cardHeight / 2 - 12 }}
      >
        <Link2 className="size-3.5" aria-hidden />
      </button>
    </motion.div>
  );
});
