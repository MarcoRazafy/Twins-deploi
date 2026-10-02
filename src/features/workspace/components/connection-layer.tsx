"use client";

import { Unlink } from "lucide-react";
import { motion, useTransform } from "motion/react";
import { memo, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { CANVAS } from "@/lib/constants";
import type { Service, ServiceConnection } from "@/lib/types";

import type { CanvasEngine } from "../lib/canvas-engine";
import { boxHeight, connectionGeometry, type EdgeGeometry } from "../lib/geometry";

type MarkerTone = "default" | "active" | "flow";

const MARKER_FILL: Record<MarkerTone, string> = {
  default: "fill-border-strong",
  active: "fill-brand-400",
  flow: "fill-info",
};

interface EdgeProps {
  connection: ServiceConnection;
  from: Service;
  to: Service;
  engine: CanvasEngine;
  selected: boolean;
  markerPrefix: string;
  onSelect: (id: string) => void;
}

function useEdgeGeometry(engine: CanvasEngine, from: Service, to: Service) {
  const fromNode = engine.node(from.id, from.position);
  const toNode = engine.node(to.id, to.position);
  const fromHeight = boxHeight(from);
  const toHeight = boxHeight(to);
  return useTransform<number, EdgeGeometry>([fromNode.x, fromNode.y, toNode.x, toNode.y], ([ax, ay, bx, by]) =>
    connectionGeometry(
      { x: ax, y: ay, w: CANVAS.cardWidth, h: fromHeight },
      { x: bx, y: by, w: CANVAS.cardWidth, h: toHeight },
    ),
  );
}

function Edge({ connection, from, to, engine, selected, markerPrefix, onSelect }: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const geometry = useEdgeGeometry(engine, from, to);
  const d = useTransform(geometry, (value) => value.d);

  const flowing = from.status === "building" || from.status === "deploying";
  const highlighted = selected || hovered;
  const tone: MarkerTone = flowing ? "flow" : highlighted ? "active" : "default";

  return (
    <g>
      {/* Wide invisible stroke: a comfortable hit area for hover and click. */}
      <motion.path
        d={d}
        fill="none"
        strokeWidth={18}
        pointerEvents="stroke"
        data-canvas-ui
        className="cursor-pointer stroke-transparent"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(connection.id);
        }}
      />
      <motion.path
        d={d}
        fill="none"
        strokeWidth={highlighted ? 2 : 1.5}
        strokeDasharray="4 4"
        markerEnd={`url(#${markerPrefix}-${tone})`}
        pointerEvents="none"
        className={
          flowing
            ? "animate-dash-flow stroke-info"
            : highlighted
              ? "stroke-brand-400"
              : "stroke-border-strong"
        }
      />
    </g>
  );
}

interface RubberBandProps {
  engine: CanvasEngine;
  from: Service;
  markerPrefix: string;
}

function RubberBand({ engine, from, markerPrefix }: RubberBandProps) {
  const node = engine.node(from.id, from.position);
  const height = boxHeight(from);
  const d = useTransform<number, string>([node.x, node.y, engine.linkX, engine.linkY], ([ax, ay, px, py]) =>
    connectionGeometry(
      { x: ax, y: ay, w: CANVAS.cardWidth, h: height },
      { x: px, y: py, w: 0, h: 0 },
    ).d,
  );
  return (
    <motion.path
      d={d}
      fill="none"
      strokeWidth={2}
      strokeDasharray="4 4"
      markerEnd={`url(#${markerPrefix}-active)`}
      pointerEvents="none"
      className="stroke-brand-400"
    />
  );
}

export interface ConnectionLayerProps {
  engine: CanvasEngine;
  services: readonly Service[];
  connections: readonly ServiceConnection[];
  selectedConnectionId: string | null;
  linkingFromId: string | null;
  onSelectConnection: (id: string) => void;
}

/** SVG layer in world coordinates, drawn under the cards. */
export const ConnectionLayer = memo(function ConnectionLayer({
  engine,
  services,
  connections,
  selectedConnectionId,
  linkingFromId,
  onSelectConnection,
}: ConnectionLayerProps) {
  const markerPrefix = `arrow${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const byId = new Map(services.map((service) => [service.id, service]));
  const linkingFrom = linkingFromId ? byId.get(linkingFromId) : undefined;

  return (
    <svg
      width={1}
      height={1}
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      aria-hidden
    >
      <defs>
        {(Object.keys(MARKER_FILL) as MarkerTone[]).map((tone) => (
          <marker
            key={tone}
            id={`${markerPrefix}-${tone}`}
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={10}
            markerHeight={10}
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M0 1 L10 5 L0 9 Z" className={MARKER_FILL[tone]} />
          </marker>
        ))}
      </defs>
      {connections.map((connection) => {
        const from = byId.get(connection.fromServiceId);
        const to = byId.get(connection.toServiceId);
        if (!from || !to) return null;
        return (
          <Edge
            key={`${connection.id}-${boxHeight(from)}-${boxHeight(to)}`}
            connection={connection}
            from={from}
            to={to}
            engine={engine}
            selected={selectedConnectionId === connection.id}
            markerPrefix={markerPrefix}
            onSelect={onSelectConnection}
          />
        );
      })}
      {linkingFrom ? (
        <RubberBand engine={engine} from={linkingFrom} markerPrefix={markerPrefix} />
      ) : null}
    </svg>
  );
});

export interface ConnectionActionProps {
  engine: CanvasEngine;
  connection: ServiceConnection;
  from: Service;
  to: Service;
  pending: boolean;
  onDelete: (connection: ServiceConnection) => void;
}

/** Floating action at the midpoint of the selected connection. */
export function ConnectionAction({
  engine,
  connection,
  from,
  to,
  pending,
  onDelete,
}: ConnectionActionProps) {
  const geometry = useEdgeGeometry(engine, from, to);
  const x = useTransform(geometry, (value) => value.mx);
  const y = useTransform(geometry, (value) => value.my);
  // Keeps the button a constant on-screen size whatever the zoom.
  const scale = useTransform(engine.zoom, (zoom) => Math.min(1 / zoom, 1.5));

  return (
    <motion.div
      data-canvas-ui
      className="absolute top-0 left-0 z-30"
      style={{ x, y }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div style={{ scale }} className="-translate-x-1/2 -translate-y-1/2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => onDelete(connection)}
          onPointerDown={(event) => event.stopPropagation()}
          className="bg-popover shadow-lg shadow-black/40 hover:text-destructive"
          aria-label={`Supprimer la connexion de ${from.name} vers ${to.name}`}
        >
          <Unlink data-icon="inline-start" />
          Supprimer
        </Button>
      </motion.div>
    </motion.div>
  );
}
