import { CANVAS } from "@/lib/constants";
import type { ID, Position, Service, ServiceConnection } from "@/lib/types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EdgeGeometry {
  /** SVG path of the cubic Bezier. */
  d: string;
  /** Midpoint of the curve (anchor of the floating delete action). */
  mx: number;
  my: number;
}

/** Height of a card including its attached volume footer. */
export function boxHeight(service: Pick<Service, "volume">): number {
  return CANVAS.cardHeight + (service.volume ? CANVAS.volumeHeight : 0);
}

export function snap(value: number): number {
  return Math.round(value / CANVAS.grid) * CANVAS.grid;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Cubic Bezier from the edge of `a` nearest to `b` to the nearest edge of `b`,
 * anchored at the middle of each edge. The curve leaves and enters
 * perpendicular to the edges.
 */
export function connectionGeometry(a: Rect, b: Rect): EdgeGeometry {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const dx = bcx - acx;
  const dy = bcy - acy;
  const horizontal =
    Math.abs(dx) / Math.max(1, (a.w + b.w) / 2) >= Math.abs(dy) / Math.max(1, (a.h + b.h) / 2);

  let p0: Position;
  let p1: Position;
  let n0: Position;
  let n1: Position;
  if (horizontal) {
    if (dx >= 0) {
      p0 = { x: a.x + a.w, y: acy };
      p1 = { x: b.x, y: bcy };
      n0 = { x: 1, y: 0 };
      n1 = { x: -1, y: 0 };
    } else {
      p0 = { x: a.x, y: acy };
      p1 = { x: b.x + b.w, y: bcy };
      n0 = { x: -1, y: 0 };
      n1 = { x: 1, y: 0 };
    }
  } else if (dy >= 0) {
    p0 = { x: acx, y: a.y + a.h };
    p1 = { x: bcx, y: b.y };
    n0 = { x: 0, y: 1 };
    n1 = { x: 0, y: -1 };
  } else {
    p0 = { x: acx, y: a.y };
    p1 = { x: bcx, y: b.y + b.h };
    n0 = { x: 0, y: -1 };
    n1 = { x: 0, y: 1 };
  }

  const reach = clamp(Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.4, 32, 160);
  const c0 = { x: p0.x + n0.x * reach, y: p0.y + n0.y * reach };
  const c1 = { x: p1.x + n1.x * reach, y: p1.y + n1.y * reach };
  return {
    d: `M${p0.x} ${p0.y} C${c0.x} ${c0.y} ${c1.x} ${c1.y} ${p1.x} ${p1.y}`,
    mx: (p0.x + 3 * c0.x + 3 * c1.x + p1.x) / 8,
    my: (p0.y + 3 * c0.y + 3 * c1.y + p1.y) / 8,
  };
}

const LAYOUT_COLUMN_GAP = 120;
const LAYOUT_ROW_GAP = 48;

/**
 * Tidy layered layout: a service sits one column to the left of the services
 * it depends on (connection direction = left to right), columns are stacked
 * and centred vertically, and everything lands on the snap grid.
 */
export function autoLayout(
  services: readonly Service[],
  connections: readonly ServiceConnection[],
): Record<ID, Position> {
  const ids = new Set(services.map((service) => service.id));
  const edges = connections.filter(
    (edge) => ids.has(edge.fromServiceId) && ids.has(edge.toServiceId),
  );

  const rank = new Map<ID, number>(services.map((service) => [service.id, 0]));
  const maxRank = Math.max(0, services.length - 1);
  // Bounded relaxation so a cycle cannot loop forever.
  for (let pass = 0; pass < services.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const next = Math.min(maxRank, (rank.get(edge.fromServiceId) ?? 0) + 1);
      if ((rank.get(edge.toServiceId) ?? 0) < next) {
        rank.set(edge.toServiceId, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const columns: Service[][] = [];
  for (const service of services) {
    const index = rank.get(service.id) ?? 0;
    (columns[index] ??= []).push(service);
  }

  const order = new Map<ID, number>();
  columns.forEach((column, columnIndex) => {
    if (!column) return;
    const barycenter = (service: Service): number => {
      const neighbours = edges
        .filter((edge) => edge.toServiceId === service.id)
        .map((edge) => order.get(edge.fromServiceId))
        .filter((value): value is number => value !== undefined);
      if (columnIndex === 0 || neighbours.length === 0) return service.position.y;
      return neighbours.reduce((sum, value) => sum + value, 0) / neighbours.length;
    };
    column
      .map((service) => ({ service, key: barycenter(service) }))
      .sort((a, b) => a.key - b.key || a.service.name.localeCompare(b.service.name))
      .forEach(({ service }, row) => {
        column[row] = service;
        order.set(service.id, row);
      });
  });

  const heights = columns.map((column) =>
    (column ?? []).reduce(
      (sum, service, row) => sum + boxHeight(service) + (row > 0 ? LAYOUT_ROW_GAP : 0),
      0,
    ),
  );
  const tallest = Math.max(0, ...heights);
  const originX = snap(Math.min(...services.map((service) => service.position.x)));
  const originY = snap(Math.min(...services.map((service) => service.position.y)));

  const result: Record<ID, Position> = {};
  columns.forEach((column, columnIndex) => {
    if (!column) return;
    let y = originY + (tallest - heights[columnIndex]) / 2;
    for (const service of column) {
      result[service.id] = {
        x: snap(originX + columnIndex * (CANVAS.cardWidth + LAYOUT_COLUMN_GAP)),
        y: snap(y),
      };
      y += boxHeight(service) + LAYOUT_ROW_GAP;
    }
  });
  return result;
}
