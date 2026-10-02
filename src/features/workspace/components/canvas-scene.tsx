"use client";

import { Maximize, Plus } from "lucide-react";
import { AnimatePresence, motion, useTransform } from "motion/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { CreateDatabaseDialog } from "@/features/databases";
import { DeployImageDialog } from "@/features/docker";
import { ImportRepoDialog } from "@/features/github";
import { ServicePanel } from "@/features/services";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useHotkey } from "@/hooks/use-hotkey";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useQueryParams } from "@/hooks/use-query-param";
import { getErrorMessage } from "@/lib/api/contract";
import { CANVAS } from "@/lib/constants";
import { isDeploymentInFlight } from "@/lib/status";
import { SPRING, STAGGER, slideInRight } from "@/lib/motion";
import {
  useConnectServices,
  useDeleteService,
  useDisconnectServices,
  useServiceAction,
  useTriggerDeployment,
  useUpdateServicePositions,
  type ServiceAction,
} from "@/lib/queries";
import type {
  Deployment,
  Position,
  Project,
  Service,
  ServiceConnection,
  ServiceType,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";

import { CanvasEngine, panelWidthFor, type Size } from "../lib/canvas-engine";
import { autoLayout, clamp, snap } from "../lib/geometry";
import { AddOptionList } from "./add-options";
import { AddServiceDialog } from "./add-service-dialog";
import { CanvasMenuBody, type MenuTarget } from "./canvas-context-menu";
import { CanvasControls } from "./canvas-controls";
import { ConnectionAction, ConnectionLayer } from "./connection-layer";
import { ServiceNode, type LinkRole } from "./service-node";
import { ProjectChip } from "./workspace-chrome";

const NUDGE_DEBOUNCE_MS = 450;
const VIEWPORT_SAVE_MS = 300;
const ZOOM_STEP = 1.25;

type Flow = { kind: ServiceType; placeAt: Position | null };

interface PendingNudge {
  before: Record<string, Position>;
  after: Record<string, Position>;
  timer: ReturnType<typeof setTimeout> | null;
}

interface CanvasSceneProps {
  project: Project;
  services: Service[];
  connections: ServiceConnection[];
  deployments: Deployment[];
  /** Size of the frame, measured by the parent. */
  size: Size;
  /** Services are being refetched: do not treat a missing selection as stale. */
  isFetching: boolean;
}

/** The live canvas: surface, cards, connections, controls, menus and panel. */
export function CanvasScene({
  project,
  services,
  connections,
  deployments,
  size,
  isFetching,
}: CanvasSceneProps) {
  const projectId = project.id;
  const [engine] = useState(
    () =>
      new CanvasEngine(
        size,
        services,
        useWorkspaceStore.getState().viewports[projectId] ?? null,
      ),
  );
  // Cards present on first render fade in one after the other; later ones pop in.
  const [initialOrder] = useState(
    () => new Map(services.map((service, index) => [service.id, index])),
  );

  const { get: getParam, set: setParams } = useQueryParams();
  const serviceParam = getParam("service");
  const newParam = getParam("new");
  const selectedService = serviceParam
    ? (services.find((service) => service.id === serviceParam) ?? null)
    : null;
  const selectedId = selectedService?.id ?? null;

  const showGrid = useWorkspaceStore((state) => state.showGrid);
  const snapToGrid = useWorkspaceStore((state) => state.snapToGrid);
  const canUndo = useWorkspaceStore(
    (state) => (state.history[projectId]?.undo.length ?? 0) > 0,
  );
  const canRedo = useWorkspaceStore(
    (state) => (state.history[projectId]?.redo.length ?? 0) > 0,
  );

  const { mutate: savePositions } = useUpdateServicePositions();
  const { mutate: connectServices } = useConnectServices();
  const { mutate: disconnectServices, isPending: disconnecting } =
    useDisconnectServices();
  const { mutateAsync: deleteService } = useDeleteService();
  const { mutate: triggerDeployment } = useTriggerDeployment();
  const { mutate: runServiceAction } = useServiceAction();
  const { copy } = useCopyToClipboard();

  const [selectedConnectionId, setSelectedConnectionId] = useState<
    string | null
  >(null);
  const [menuTarget, setMenuTarget] = useState<MenuTarget>({
    kind: "canvas",
    world: { x: 0, y: 0 },
  });
  const [addState, setAddState] = useState(false);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);
  const [linking, setLinking] = useState<{
    fromId: string;
    hoverId: string | null;
  } | null>(null);

  // Viewport-based (md breakpoint), not frame-based: the sidebar eats 240 px on desktop.
  const isMobile = !useMediaQuery("(min-width: 768px)", true);
  const panelOpen = selectedService !== null;
  const panelWidth = panelOpen ? panelWidthFor(size.width, isMobile) : 0;
  const addOpen = addState || newParam === "1";

  const surfaceRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Position>());
  const pan = useRef<{
    startX: number;
    startY: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null>(null);
  const pinch = useRef<{
    distance: number;
    zoom: number;
    wx: number;
    wy: number;
  } | null>(null);
  const nudgeRef = useRef<PendingNudge>({ before: {}, after: {}, timer: null });

  // ── Derived data ───────────────────────────────────────────────────────────

  const latestDeployments = useMemo(() => {
    const latest = new Map<string, Deployment>();
    for (const deployment of deployments) {
      const current = latest.get(deployment.serviceId);
      if (!current || deployment.createdAt > current.createdAt) {
        latest.set(deployment.serviceId, deployment);
      }
    }
    return latest;
  }, [deployments]);

  const connectedPairs = useMemo(
    () =>
      new Set(
        connections.map((edge) => `${edge.fromServiceId}>${edge.toServiceId}`),
      ),
    [connections],
  );
  const areConnected = (a: string, b: string) =>
    connectedPairs.has(`${a}>${b}`) || connectedPairs.has(`${b}>${a}`);

  const selectedConnection = selectedConnectionId
    ? (connections.find((edge) => edge.id === selectedConnectionId) ?? null)
    : null;
  const selectedConnectionFrom = selectedConnection
    ? services.find(
        (service) => service.id === selectedConnection.fromServiceId,
      )
    : undefined;
  const selectedConnectionTo = selectedConnection
    ? services.find((service) => service.id === selectedConnection.toServiceId)
    : undefined;

  // ── Dot grid following pan and zoom ────────────────────────────────────────

  const dotGap = useTransform(engine.zoom, (zoom) => {
    let gap = CANVAS.grid * zoom;
    // Keep the dots readable at low zoom by skipping every other line.
    while (gap < 14) gap *= 2;
    return gap;
  });
  const backgroundSize = useTransform(dotGap, (gap) => `${gap}px ${gap}px`);
  const backgroundPosition = useTransform<number, string>(
    [engine.x, engine.y, dotGap],
    ([x, y, gap]) => `${x - gap / 2}px ${y - gap / 2}px`,
  );

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;
    engine.attachFrame(element);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      engine.stopViewAnimations();
      const unit = event.deltaMode === 1 ? 16 : 1;
      const pinching = event.ctrlKey;
      const mouseWheel =
        !pinching &&
        (event.deltaMode !== 0 ||
          (event.deltaX === 0 && Math.abs(event.deltaY) >= 50));
      if (pinching || mouseWheel) {
        engine.zoomAtClient(
          Math.exp(-event.deltaY * unit * (pinching ? 0.01 : 0.0015)),
          event.clientX,
          event.clientY,
        );
      } else {
        engine.panBy(-event.deltaX, -event.deltaY);
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
      engine.attachFrame(null);
    };
  }, [engine]);

  useEffect(() => {
    engine.setSize(size);
  }, [engine, size]);

  useEffect(() => {
    if (engine.syncServices(services)) engine.fit({ animated: true });
  }, [engine, services]);

  useEffect(() => {
    engine.setPanelWidth(panelWidth);
    if (selectedId) engine.ensureVisible(selectedId);
  }, [engine, panelWidth, selectedId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () =>
      useWorkspaceStore.getState().setViewport(projectId, engine.viewport());
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(save, VIEWPORT_SAVE_MS);
    };
    const unsubscribe = [engine.x, engine.y, engine.zoom].map((value) =>
      value.on("change", schedule),
    );
    return () => {
      for (const stop of unsubscribe) stop();
      if (timer !== undefined) {
        clearTimeout(timer);
        save();
      }
    };
  }, [engine, projectId]);

  // A service id that does not belong to this project (or was deleted) is dropped from the URL.
  useEffect(() => {
    if (serviceParam && !selectedService && !isFetching) {
      setParams({ service: null, tab: null });
    }
  }, [serviceParam, selectedService, isFetching, setParams]);

  // ── Moves, history ─────────────────────────────────────────────────────────

  const applyPositions = useCallback(
    (positions: Record<string, Position>) => {
      savePositions(positions, {
        onError: (error) =>
          toast.error(
            getErrorMessage(error, "Impossible d’enregistrer la position."),
          ),
      });
    },
    [savePositions],
  );

  const commitMove = useCallback(
    (before: Record<string, Position>, after: Record<string, Position>) => {
      applyPositions(after);
      useWorkspaceStore.getState().pushMove(projectId, { before, after });
    },
    [applyPositions, projectId],
  );

  const flushNudge = useCallback(() => {
    const pending = nudgeRef.current;
    if (pending.timer) clearTimeout(pending.timer);
    nudgeRef.current = { before: {}, after: {}, timer: null };
    if (Object.keys(pending.after).length > 0)
      commitMove(pending.before, pending.after);
  }, [commitMove]);

  useEffect(() => flushNudge, [flushNudge]);

  const handleMoveEnd = useCallback(
    (id: string, before: Position, after: Position) =>
      commitMove({ [id]: before }, { [id]: after }),
    [commitMove],
  );

  const handleNudge = useCallback(
    (id: string, stepsX: number, stepsY: number) => {
      const pending = nudgeRef.current;
      const origin = engine.syncedPosition(id);
      const current = pending.after[id] ?? engine.currentPosition(id);
      if (!origin || !current) return;
      if (pending.timer) clearTimeout(pending.timer);
      pending.before[id] ??= origin;
      const next = {
        x: current.x + stepsX * CANVAS.grid,
        y: current.y + stepsY * CANVAS.grid,
      };
      pending.after[id] = next;
      engine.moveNode(id, next, true);
      pending.timer = setTimeout(flushNudge, NUDGE_DEBOUNCE_MS);
    },
    [engine, flushNudge],
  );

  const restore = (entry: { positions: Record<string, Position> } | null) => {
    if (!entry) return;
    const existing = new Set(services.map((service) => service.id));
    const positions = Object.fromEntries(
      Object.entries(entry.positions).filter(([id]) => existing.has(id)),
    );
    if (Object.keys(positions).length > 0) applyPositions(positions);
  };

  function undo() {
    flushNudge();
    const entry = useWorkspaceStore.getState().undoMove(projectId);
    restore(entry && { positions: entry.before });
  }

  function redo() {
    const entry = useWorkspaceStore.getState().redoMove(projectId);
    restore(entry && { positions: entry.after });
  }

  function arrange() {
    if (services.length < 2) return;
    flushNudge();
    const after = autoLayout(services, connections);
    const before = Object.fromEntries(
      services.map((service) => [service.id, service.position]),
    );
    const changed = services.some(
      (service) =>
        after[service.id].x !== service.position.x ||
        after[service.id].y !== service.position.y,
    );
    if (!changed) {
      engine.fit({ animated: true });
      toast("Les services sont déjà organisés");
      return;
    }
    commitMove(before, after);
    engine.fit({ animated: true, positions: new Map(Object.entries(after)) });
    toast.success("Services organisés", {
      action: { label: "Annuler", onClick: undo },
    });
  }

  // ── Selection and panel ────────────────────────────────────────────────────

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedConnectionId(null);
      setParams({ service: id });
    },
    [setParams],
  );

  const closePanel = useCallback(
    () => setParams({ service: null, tab: null }),
    [setParams],
  );

  const openService = useCallback(
    (id: string, tab?: string) => {
      setSelectedConnectionId(null);
      setParams({ service: id, ...(tab ? { tab } : {}) });
    },
    [setParams],
  );

  // ── Service actions ────────────────────────────────────────────────────────

  function redeploy(service: Service) {
    triggerDeployment(
      { serviceId: service.id, trigger: "redeploy" },
      {
        onSuccess: () =>
          toast.success("Redéploiement lancé", { description: service.name }),
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  }

  function lifecycle(service: Service, action: ServiceAction) {
    const labels: Record<ServiceAction, string> = {
      start: "Service démarré",
      stop: "Service arrêté",
      restart: "Redémarrage en cours",
    };
    runServiceAction(
      { id: service.id, action },
      {
        onSuccess: () =>
          toast.success(labels[action], { description: service.name }),
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  }

  async function copyUrl(service: Service) {
    if (!service.primaryDomain) return;
    const copied = await copy(`https://${service.primaryDomain}`);
    if (copied)
      toast.success("URL copiée", { description: service.primaryDomain });
    else toast.error("Impossible de copier l’URL");
  }

  const requestConnect = (fromId: string, toId: string) => {
    const from = services.find((service) => service.id === fromId);
    const to = services.find((service) => service.id === toId);
    if (!from || !to) return;
    if (from.id === to.id) {
      toast.error("Un service ne peut pas être relié à lui-même.");
      return;
    }
    if (areConnected(from.id, to.id)) {
      toast.error("Ces deux services sont déjà reliés.");
      return;
    }
    connectServices(
      { fromServiceId: from.id, toServiceId: to.id },
      {
        onSuccess: () =>
          toast.success(`${from.name} est relié à ${to.name}`, {
            description:
              to.source.type === "postgres"
                ? `Variable DATABASE_URL ajoutée à ${from.name}.`
                : undefined,
          }),
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  };

  function removeConnection(connection: ServiceConnection) {
    disconnectServices(connection.id, {
      onSuccess: () => {
        setSelectedConnectionId(null);
        toast.success("Connexion supprimée", {
          description: `${selectedConnectionFrom?.name ?? "Service"} · ${selectedConnectionTo?.name ?? "Service"}`,
        });
      },
      onError: (error) => toast.error(getErrorMessage(error)),
    });
  }

  // ── Connection creation (rubber band) ──────────────────────────────────────

  const handleLinkStart = useCallback(
    (id: string, clientX: number, clientY: number) => {
      const point = engine.screenToWorld(clientX, clientY);
      engine.linkX.set(point.x);
      engine.linkY.set(point.y);
      setLinking({ fromId: id, hoverId: null });
    },
    [engine],
  );

  const handleLinkMove = useCallback(
    (clientX: number, clientY: number) => {
      const point = engine.screenToWorld(clientX, clientY);
      engine.linkX.set(point.x);
      engine.linkY.set(point.y);
      const hoverId =
        document
          .elementFromPoint(clientX, clientY)
          ?.closest("[data-node-id]")
          ?.getAttribute("data-node-id") ?? null;
      setLinking((previous) =>
        previous && previous.hoverId !== hoverId
          ? { ...previous, hoverId }
          : previous,
      );
    },
    [engine],
  );

  const handleLinkEnd = (
    fromId: string,
    clientX: number | null,
    clientY: number | null,
  ) => {
    setLinking(null);
    if (clientX === null || clientY === null) return;
    const targetId = document
      .elementFromPoint(clientX, clientY)
      ?.closest("[data-node-id]")
      ?.getAttribute("data-node-id");
    if (targetId) requestConnect(fromId, targetId);
  };

  const linkRoleOf = (id: string): LinkRole => {
    if (!linking) return "idle";
    if (id === linking.fromId) return "source";
    if (areConnected(id, linking.fromId)) return "invalid";
    return linking.hoverId === id ? "target" : "valid";
  };

  // ── Flows (add a service) ──────────────────────────────────────────────────

  function handleAddOpenChange(open: boolean) {
    setAddState(open);
    if (!open && newParam === "1") setParams({ new: null });
  }

  function chooseKind(kind: ServiceType) {
    handleAddOpenChange(false);
    setFlow({ kind, placeAt: null });
  }

  function startFlowAt(kind: ServiceType, world: Position) {
    setFlow({
      kind,
      placeAt: {
        x: snap(world.x - CANVAS.cardWidth / 2),
        y: snap(world.y - CANVAS.cardHeight / 2),
      },
    });
  }

  function finishFlow(serviceId: string) {
    const placeAt = flow?.placeAt ?? null;
    setFlow(null);
    if (!placeAt) {
      handleSelect(serviceId);
      return;
    }
    // Select once the card sits where the menu was opened, so the panel pans to its final place.
    savePositions(
      { [serviceId]: placeAt },
      {
        onError: (error) =>
          toast.error(
            getErrorMessage(error, "Impossible d’enregistrer la position."),
          ),
        onSettled: () => handleSelect(serviceId),
      },
    );
  }

  function handleFlowOpenChange(open: boolean) {
    if (!open) setFlow(null);
  }

  // ── Surface gestures: pan, pinch ───────────────────────────────────────────

  function beginPinch() {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return;
    const center = engine.framePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
    const zoom = engine.zoom.get();
    pan.current = null;
    pinch.current = {
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      zoom,
      wx: (center.x - engine.x.get()) / zoom,
      wy: (center.y - engine.y.get()) / zoom,
    };
  }

  function beginPan(point: Position) {
    pinch.current = null;
    pan.current = {
      startX: point.x,
      startY: point.y,
      vx: engine.x.get(),
      vy: engine.y.get(),
      moved: false,
    };
  }

  function handleSurfacePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      !(event.target instanceof Element) ||
      event.target.closest("[data-node-id],[data-canvas-ui]")
    ) {
      return;
    }
    if (
      event.pointerType === "mouse" &&
      event.button !== 0 &&
      event.button !== 1
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    engine.stopViewAnimations();
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointers.current.size === 1)
      beginPan({ x: event.clientX, y: event.clientY });
    else if (pointers.current.size === 2) beginPinch();
  }

  function handleSurfacePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const pinching = pinch.current;
    if (pointers.current.size === 2 && pinching) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const center = engine.framePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      const zoom = clamp(
        pinching.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinching.distance),
        CANVAS.minZoom,
        CANVAS.maxZoom,
      );
      engine.setViewport({
        zoom,
        x: center.x - pinching.wx * zoom,
        y: center.y - pinching.wy * zoom,
      });
      return;
    }
    const panning = pan.current;
    if (!panning) return;
    const dx = event.clientX - panning.startX;
    const dy = event.clientY - panning.startY;
    if (!panning.moved && Math.hypot(dx, dy) < 3) return;
    panning.moved = true;
    engine.setViewport({
      x: panning.vx + dx,
      y: panning.vy + dy,
      zoom: engine.zoom.get(),
    });
  }

  function handleSurfacePointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(event.pointerId)) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const wasClick =
      pan.current !== null && !pan.current.moved && pointers.current.size === 0;
    pinch.current = null;
    const [remaining] = [...pointers.current.values()];
    if (remaining) beginPan(remaining);
    else pan.current = null;
    if (wasClick) setSelectedConnectionId(null);
  }

  // ── Context menu target ────────────────────────────────────────────────────

  function updateMenuTarget(event: {
    target: EventTarget;
    clientX: number;
    clientY: number;
  }) {
    const nodeId =
      event.target instanceof Element
        ? event.target.closest("[data-node-id]")?.getAttribute("data-node-id")
        : null;
    setMenuTarget(
      nodeId
        ? { kind: "service", id: nodeId }
        : {
            kind: "canvas",
            world: engine.screenToWorld(event.clientX, event.clientY),
          },
    );
  }

  function handleSurfacePointerDownCapture(
    event: PointerEvent<HTMLDivElement>,
  ) {
    // Long press on touch opens the menu without a contextmenu event.
    if (event.pointerType !== "mouse") updateMenuTarget(event);
  }

  function handleSurfaceContextMenuCapture(event: MouseEvent<HTMLDivElement>) {
    updateMenuTarget(event);
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  const zoomIn = () => engine.zoomBy(ZOOM_STEP);
  const zoomOut = () => engine.zoomBy(1 / ZOOM_STEP);
  const fit = () => engine.fit({ animated: true });
  const resetZoom = () => engine.zoomTo(1, true);

  useHotkey("mod+z", undo);
  useHotkey("mod+shift+z", redo);
  useHotkey("mod+y", redo);
  useHotkey("+", zoomIn);
  useHotkey("=", zoomIn);
  useHotkey("-", zoomOut);
  useHotkey("0", fit);
  useHotkey(
    "escape",
    () => {
      if (selectedConnectionId) setSelectedConnectionId(null);
      else closePanel();
    },
    { enabled: Boolean(serviceParam) || selectedConnectionId !== null },
  );
  useHotkey(
    "delete",
    () => selectedConnection && removeConnection(selectedConnection),
    {
      enabled: selectedConnection !== null,
    },
  );
  useHotkey(
    "backspace",
    () => selectedConnection && removeConnection(selectedConnection),
    {
      enabled: selectedConnection !== null,
    },
  );

  // Overlays give way when the panel leaves too little room on the left.
  const freeWidth = size.width - panelWidth;
  const hideControls = panelOpen && isMobile;
  const hideActions = panelOpen && freeWidth < 140;
  const showChip = !panelOpen || freeWidth >= 340;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <motion.div
            ref={surfaceRef}
            data-testid="canvas-surface"
            className={cn(
              "absolute inset-0 cursor-grab touch-none active:cursor-grabbing",
              showGrid && "bg-dot-grid",
            )}
            style={{ backgroundSize, backgroundPosition }}
            onPointerDown={handleSurfacePointerDown}
            onPointerMove={handleSurfacePointerMove}
            onPointerUp={handleSurfacePointerEnd}
            onPointerCancel={handleSurfacePointerEnd}
            onPointerDownCapture={handleSurfacePointerDownCapture}
            onContextMenuCapture={handleSurfaceContextMenuCapture}
            onMouseDown={(event) => {
              if (event.button === 1) event.preventDefault();
            }}
          >
            <motion.div
              data-testid="canvas-world"
              className="absolute top-0 left-0 origin-top-left will-change-transform"
              style={{
                x: engine.x,
                y: engine.y,
                scale: engine.zoom,
                originX: 0,
                originY: 0,
              }}
            >
              <ConnectionLayer
                engine={engine}
                services={services}
                connections={connections}
                selectedConnectionId={selectedConnectionId}
                linkingFromId={linking?.fromId ?? null}
                onSelectConnection={setSelectedConnectionId}
              />
              <AnimatePresence>
                {services.map((service) => {
                  const order = initialOrder.get(service.id);
                  const deployment = latestDeployments.get(service.id);
                  const inFlight =
                    deployment && isDeploymentInFlight(deployment.status);
                  return (
                    <ServiceNode
                      key={service.id}
                      service={service}
                      engine={engine}
                      selected={selectedId === service.id}
                      progress={inFlight ? deployment.progress : null}
                      lastActivityAt={
                        deployment?.createdAt ?? service.updatedAt
                      }
                      snapEnabled={snapToGrid}
                      linkRole={linkRoleOf(service.id)}
                      entranceDelay={
                        order === undefined
                          ? null
                          : Math.min(order, STAGGER.maxItems) * STAGGER.step
                      }
                      onSelect={handleSelect}
                      onMoveEnd={handleMoveEnd}
                      onNudge={handleNudge}
                      onDelete={setDeleteTarget}
                      onLinkStart={handleLinkStart}
                      onLinkMove={handleLinkMove}
                      onLinkEnd={handleLinkEnd}
                    />
                  );
                })}
              </AnimatePresence>
              <AnimatePresence>
                {selectedConnection &&
                selectedConnectionFrom &&
                selectedConnectionTo ? (
                  <ConnectionAction
                    key={selectedConnection.id}
                    engine={engine}
                    connection={selectedConnection}
                    from={selectedConnectionFrom}
                    to={selectedConnectionTo}
                    pending={disconnecting}
                    onDelete={removeConnection}
                  />
                ) : null}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          <CanvasMenuBody
            target={menuTarget}
            services={services}
            connectedPairs={connectedPairs}
            showGrid={showGrid}
            onOpenService={openService}
            onRedeploy={redeploy}
            onServiceAction={lifecycle}
            onCopyUrl={copyUrl}
            onConnect={requestConnect}
            onDelete={setDeleteTarget}
            onAddFlow={startFlowAt}
            onFit={fit}
            onResetZoom={resetZoom}
            onArrange={arrange}
            onToggleGrid={() =>
              useWorkspaceStore.getState().setShowGrid(!showGrid)
            }
          />
        </ContextMenuContent>
      </ContextMenu>

      {services.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
          <div className="pointer-events-auto w-full max-w-md rounded-xl border bg-card/95 p-5 shadow-xl shadow-black/40 backdrop-blur">
            <h2 className="text-base font-medium">
              Ajoutez votre premier service
            </h2>
            <p className="mt-1 mb-4 text-sm text-muted-foreground">
              Déployez une application, une image ou une base de données : elle
              apparaîtra ici.
            </p>
            <AddOptionList onChoose={chooseKind} />
          </div>
        </div>
      ) : null}

      {showChip ? (
        <ProjectChip
          project={project}
          services={services}
          maxWidth={panelOpen ? Math.max(120, freeWidth - 24 - 112) : undefined}
        />
      ) : null}

      {!hideActions ? (
        <motion.div
          data-canvas-ui
          className="absolute top-3 right-3 z-10 flex items-center gap-2"
          initial={false}
          animate={{ x: panelOpen ? -panelWidth : 0 }}
          transition={SPRING.smooth}
        >
          <Button
            type="button"
            variant="secondary"
            className={cn("hidden", !panelOpen && "md:inline-flex")}
            onClick={fit}
          >
            <Maximize data-icon="inline-start" />
            Ajuster
          </Button>
          <Button type="button" onClick={() => handleAddOpenChange(true)}>
            <Plus data-icon="inline-start" />
            Ajouter
          </Button>
        </motion.div>
      ) : null}

      {!hideControls ? (
        <CanvasControls
          engine={engine}
          showGrid={showGrid}
          snapToGrid={snapToGrid}
          canUndo={canUndo}
          canRedo={canRedo}
          onToggleGrid={() =>
            useWorkspaceStore.getState().setShowGrid(!showGrid)
          }
          onToggleSnap={() =>
            useWorkspaceStore.getState().setSnapToGrid(!snapToGrid)
          }
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onResetZoom={resetZoom}
          onFit={fit}
          onUndo={undo}
          onRedo={redo}
        />
      ) : null}

      <AnimatePresence>
        {selectedService ? (
          <motion.aside
            key="service-panel"
            data-canvas-ui
            aria-label={`Panneau du service ${selectedService.name}`}
            variants={slideInRight}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="absolute inset-y-0 right-0 z-20 flex flex-col overflow-hidden border-l bg-card shadow-2xl shadow-black/50"
            style={{ width: panelWidth }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ServicePanel
                projectId={projectId}
                serviceId={selectedService.id}
                onClose={closePanel}
              />
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>

      <AddServiceDialog
        open={addOpen}
        onOpenChange={handleAddOpenChange}
        onChoose={chooseKind}
      />
      <ImportRepoDialog
        open={flow?.kind === "github"}
        onOpenChange={handleFlowOpenChange}
        defaultProjectId={projectId}
        onImported={(service) => finishFlow(service.id)}
      />
      <DeployImageDialog
        open={flow?.kind === "docker"}
        onOpenChange={handleFlowOpenChange}
        defaultProjectId={projectId}
        onDeployed={(service) => finishFlow(service.id)}
      />
      <CreateDatabaseDialog
        open={flow?.kind === "postgres"}
        onOpenChange={handleFlowOpenChange}
        defaultProjectId={projectId}
        onCreated={(database) => finishFlow(database.serviceId)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        tone="danger"
        title="Supprimer le service"
        description={
          deleteTarget
            ? `Le service « ${deleteTarget.name} » sera supprimé avec ses déploiements, ses variables et ses domaines. Cette action est irréversible.`
            : ""
        }
        confirmText={deleteTarget?.name}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteService(deleteTarget.id);
            toast.success("Service supprimé", {
              description: deleteTarget.name,
            });
            if (serviceParam === deleteTarget.id) closePanel();
            setDeleteTarget(null);
          } catch (error) {
            toast.error(getErrorMessage(error));
          }
        }}
      />
    </>
  );
}
