import {
  animate,
  motionValue,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react";

import { CANVAS } from "@/lib/constants";
import { SPRING } from "@/lib/motion";
import type { Position, Service } from "@/lib/types";

import { boxHeight, clamp } from "./geometry";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface NodeMotion {
  x: MotionValue<number>;
  y: MotionValue<number>;
}

/** Room kept around the cards for the overlays (chip, buttons, control stack). */
const PADDING = { top: 72, right: 40, bottom: 40, left: 80 } as const;
const COMPACT_PADDING = { top: 64, right: 16, bottom: 16, left: 56 } as const;
/** Below this free width the panel is considered full screen (mobile). */
const MIN_FREE_WIDTH = 160;

/**
 * Imperative state of one canvas: the viewport and the position of every card
 * live in motion values, so panning, zooming and dragging never re-render
 * React. Connections subscribe to the same values and follow in real time.
 */
export class CanvasEngine {
  readonly x: MotionValue<number>;
  readonly y: MotionValue<number>;
  readonly zoom: MotionValue<number>;
  /** Pointer (world units) of the connection rubber band. */
  readonly linkX = motionValue(0);
  readonly linkY = motionValue(0);

  private size: Size;
  private panelWidth = 0;
  private frame: HTMLElement | null = null;
  private hadServices: boolean;
  private readonly nodes = new Map<string, NodeMotion>();
  private readonly heights = new Map<string, number>();
  private readonly synced = new Map<string, Position>();
  private readonly dragging = new Set<string>();
  private viewAnimations: AnimationPlaybackControls[] = [];
  private readonly nodeAnimations = new Map<string, AnimationPlaybackControls[]>();

  constructor(size: Size, services: readonly Service[], stored: Viewport | null) {
    this.size = size;
    this.hadServices = services.length > 0;
    for (const service of services) {
      this.heights.set(service.id, boxHeight(service));
      this.synced.set(service.id, service.position);
      this.node(service.id, service.position);
    }
    const initial = stored ?? this.computeFit(this.synced);
    this.x = motionValue(initial.x);
    this.y = motionValue(initial.y);
    this.zoom = motionValue(clamp(initial.zoom, CANVAS.minZoom, CANVAS.maxZoom));
  }

  /** Callback ref of the surface element: gives access to its screen rectangle. */
  readonly attachFrame = (element: HTMLElement | null): void => {
    this.frame = element;
  };

  setSize(size: Size): void {
    this.size = size;
  }

  setPanelWidth(width: number): void {
    this.panelWidth = width;
  }

  viewport(): Viewport {
    return { x: this.x.get(), y: this.y.get(), zoom: this.zoom.get() };
  }

  /** Get or create the motion values of a card (idempotent, safe during render). */
  node(id: string, fallback: Position): NodeMotion {
    let node = this.nodes.get(id);
    if (!node) {
      node = { x: motionValue(fallback.x), y: motionValue(fallback.y) };
      this.nodes.set(id, node);
    }
    return node;
  }

  /**
   * Aligns the cards with the server data. Cards whose stored position changed
   * glide to it (auto-layout, undo, another tab); a card being dragged is left
   * alone. Returns true when the canvas just went from empty to non-empty.
   */
  syncServices(services: readonly Service[]): boolean {
    const present = new Set<string>();
    for (const service of services) {
      present.add(service.id);
      this.heights.set(service.id, boxHeight(service));
      const previous = this.synced.get(service.id);
      this.synced.set(service.id, service.position);
      const node = this.node(service.id, service.position);
      if (!previous) continue;
      if (previous.x === service.position.x && previous.y === service.position.y) continue;
      if (this.dragging.has(service.id)) continue;
      this.animateNode(service.id, node, service.position);
    }
    for (const id of [...this.synced.keys()]) {
      if (present.has(id)) continue;
      this.synced.delete(id);
      this.heights.delete(id);
    }
    const appeared = !this.hadServices && services.length > 0;
    this.hadServices = services.length > 0;
    return appeared;
  }

  /** Position the server knows about (target of the last sync). */
  syncedPosition(id: string): Position | undefined {
    return this.synced.get(id);
  }

  /** Position currently displayed (follows drags and animations). */
  currentPosition(id: string): Position | undefined {
    const node = this.nodes.get(id);
    return node ? { x: node.x.get(), y: node.y.get() } : undefined;
  }

  moveNode(id: string, position: Position, animated: boolean): void {
    const node = this.nodes.get(id);
    if (!node) return;
    if (animated) this.animateNode(id, node, position, SPRING.snappy);
    else {
      this.stopNodeAnimations(id);
      node.x.set(position.x);
      node.y.set(position.y);
    }
  }

  beginDrag(id: string): void {
    this.dragging.add(id);
    this.stopNodeAnimations(id);
  }

  endDrag(id: string): void {
    this.dragging.delete(id);
  }

  private animateNode(
    id: string,
    node: NodeMotion,
    position: Position,
    transition: typeof SPRING.smooth | typeof SPRING.snappy = SPRING.smooth,
  ): void {
    this.stopNodeAnimations(id);
    this.nodeAnimations.set(id, [
      animate(node.x, position.x, transition),
      animate(node.y, position.y, transition),
    ]);
  }

  private stopNodeAnimations(id: string): void {
    for (const controls of this.nodeAnimations.get(id) ?? []) controls.stop();
    this.nodeAnimations.delete(id);
  }

  // ── Coordinates ────────────────────────────────────────────────────────────

  /** Client coordinates relative to the surface. */
  framePoint(clientX: number, clientY: number): Position {
    const rect = this.frame?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: clientX, y: clientY };
  }

  screenToWorld(clientX: number, clientY: number): Position {
    const point = this.framePoint(clientX, clientY);
    const zoom = this.zoom.get();
    return { x: (point.x - this.x.get()) / zoom, y: (point.y - this.y.get()) / zoom };
  }

  // ── Viewport ───────────────────────────────────────────────────────────────

  stopViewAnimations(): void {
    for (const controls of this.viewAnimations) controls.stop();
    this.viewAnimations = [];
  }

  /** Instant change (gestures). */
  setViewport(viewport: Viewport): void {
    this.stopViewAnimations();
    this.x.set(viewport.x);
    this.y.set(viewport.y);
    this.zoom.set(clamp(viewport.zoom, CANVAS.minZoom, CANVAS.maxZoom));
  }

  private moveViewport(viewport: Viewport, animated: boolean): void {
    if (!animated) {
      this.setViewport(viewport);
      return;
    }
    this.stopViewAnimations();
    this.viewAnimations = [
      animate(this.x, viewport.x, SPRING.smooth),
      animate(this.y, viewport.y, SPRING.smooth),
      animate(this.zoom, clamp(viewport.zoom, CANVAS.minZoom, CANVAS.maxZoom), SPRING.smooth),
    ];
  }

  panBy(dx: number, dy: number): void {
    this.setViewport({ x: this.x.get() + dx, y: this.y.get() + dy, zoom: this.zoom.get() });
  }

  /** Zoom keeping the point under (clientX, clientY) fixed. */
  zoomAtClient(factor: number, clientX: number, clientY: number): void {
    const anchor = this.framePoint(clientX, clientY);
    this.zoomAround(this.zoom.get() * factor, anchor, false);
  }

  zoomTo(target: number, animated: boolean): void {
    this.zoomAround(target, this.freeCenter(), animated);
  }

  zoomBy(factor: number): void {
    this.zoomTo(this.zoom.get() * factor, true);
  }

  private zoomAround(target: number, anchor: Position, animated: boolean): void {
    const current = this.viewport();
    const zoom = clamp(target, CANVAS.minZoom, CANVAS.maxZoom);
    const worldX = (anchor.x - current.x) / current.zoom;
    const worldY = (anchor.y - current.y) / current.zoom;
    this.moveViewport(
      { x: anchor.x - worldX * zoom, y: anchor.y - worldY * zoom, zoom },
      animated,
    );
  }

  /** Fits every card (volume footers included) in the free area. */
  fit(options: { animated: boolean; positions?: ReadonlyMap<string, Position> }): void {
    this.moveViewport(this.computeFit(options.positions ?? this.synced), options.animated);
  }

  /** Pans (animated) just enough for the card to sit inside the free area. */
  ensureVisible(id: string): void {
    const node = this.nodes.get(id);
    const height = this.heights.get(id);
    if (!node || height === undefined || this.coversEverything()) return;

    const free = this.freeArea();
    const { x, y, zoom } = this.viewport();
    // Aim at where the card is going (server position), not where an animation currently is.
    const target = this.synced.get(id) ?? { x: node.x.get(), y: node.y.get() };
    const left = x + target.x * zoom;
    const top = y + target.y * zoom;
    const right = left + CANVAS.cardWidth * zoom;
    const bottom = top + height * zoom;

    let dx = 0;
    let dy = 0;
    if (right - left > free.right - free.left || left < free.left) dx = free.left - left;
    else if (right > free.right) dx = free.right - right;
    if (bottom - top > free.bottom - free.top || top < free.top) dy = free.top - top;
    else if (bottom > free.bottom) dy = free.bottom - bottom;

    if (dx !== 0 || dy !== 0) this.moveViewport({ x: x + dx, y: y + dy, zoom }, true);
  }

  private coversEverything(): boolean {
    return this.panelWidth > 0 && this.size.width - this.panelWidth < MIN_FREE_WIDTH;
  }

  private freeArea(): { left: number; right: number; top: number; bottom: number } {
    const panel = this.panelWidth > 0 && !this.coversEverything() ? this.panelWidth : 0;
    const padding = this.size.width < 640 ? COMPACT_PADDING : PADDING;
    const left = padding.left;
    const top = padding.top;
    return {
      left,
      top,
      right: Math.max(left + 1, this.size.width - panel - padding.right),
      bottom: Math.max(top + 1, this.size.height - padding.bottom),
    };
  }

  private freeCenter(): Position {
    const panel = this.panelWidth > 0 && !this.coversEverything() ? this.panelWidth : 0;
    return { x: (this.size.width - panel) / 2, y: this.size.height / 2 };
  }

  private computeFit(positions: ReadonlyMap<string, Position>): Viewport {
    if (positions.size === 0) {
      return { x: this.size.width / 2, y: this.size.height / 2, zoom: 1 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [id, position] of positions) {
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxX = Math.max(maxX, position.x + CANVAS.cardWidth);
      maxY = Math.max(maxY, position.y + (this.heights.get(id) ?? CANVAS.cardHeight));
    }
    const free = this.freeArea();
    const areaWidth = free.right - free.left;
    const areaHeight = free.bottom - free.top;
    const zoom = clamp(
      Math.min(areaWidth / (maxX - minX), areaHeight / (maxY - minY)),
      CANVAS.minZoom,
      1,
    );
    return {
      zoom,
      x: free.left + (areaWidth - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: free.top + (areaHeight - (maxY - minY) * zoom) / 2 - minY * zoom,
    };
  }
}

/** Width of the service panel (px): full width on small viewports, ~62 % otherwise. */
export function panelWidthFor(surfaceWidth: number, fullWidth: boolean): number {
  if (fullWidth) return surfaceWidth;
  return Math.min(surfaceWidth - 120, clamp(surfaceWidth * 0.62, 560, 980));
}
