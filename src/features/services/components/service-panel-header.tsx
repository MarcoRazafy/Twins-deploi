"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Database,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCw,
  Rocket,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ServiceIcon } from "@/components/shared/service-icon";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { getErrorMessage, isApiError } from "@/lib/api/contract";
import { useDatabaseByService, useServiceAction, useUpdateService } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { isServiceBusy, SERVICE_TYPE_LABELS } from "@/lib/status";
import type { Service } from "@/lib/types";

import { useServiceDeploy } from "../hooks/use-service-deploy";
import { DeleteServiceDialog } from "./delete-service-dialog";
import { IconAction } from "./icon-action";

const NAME_ERROR = "Le nom doit contenir entre 2 et 40 caractères.";

function EditableName({ service }: { service: Service }) {
  const update = useUpdateService();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function startEditing() {
    setDraft(service.name);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const name = draft.trim();
    if (name === service.name) return cancel();
    if (name.length < 2 || name.length > 40) return setError(NAME_ERROR);
    try {
      await update.mutateAsync({ id: service.id, patch: { name } });
      toast.success("Service renommé", { description: `${service.name} → ${name}` });
      setEditing(false);
    } catch (caught) {
      if (isApiError(caught) && caught.field === "name") setError(caught.message);
      else toast.error(getErrorMessage(caught));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") return;
    // Consumed here so the panel itself does not close.
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <h2
          className="min-w-0 truncate text-lg font-semibold tracking-tight"
          title={`${service.name} (double-clic pour renommer)`}
          onDoubleClick={startEditing}
        >
          {service.name}
        </h2>
        <IconAction label="Renommer le service" size="icon-xs" onClick={startEditing}>
          <Pencil />
        </IconAction>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="min-w-0 flex-1" noValidate>
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          aria-label="Nom du service"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "service-rename-error" : undefined}
          maxLength={60}
          className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2 text-base font-semibold tracking-tight outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
        />
        <IconAction label="Enregistrer le nom" type="submit" size="icon-xs" disabled={update.isPending}>
          {update.isPending ? <Spinner /> : <Check />}
        </IconAction>
        <IconAction label="Annuler" size="icon-xs" onClick={cancel}>
          <X />
        </IconAction>
      </div>
      {error ? (
        <p id="service-rename-error" role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function Subline({ service }: { service: Service }) {
  const { source } = service;
  const typeLabel = SERVICE_TYPE_LABELS[source.type];

  let detail: ReactNode = null;
  if (service.primaryDomain) {
    detail = (
      <a
        href={`https://${service.primaryDomain}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-w-0 items-center gap-1 text-brand-400 hover:underline"
      >
        <span className="truncate">{service.primaryDomain}</span>
        <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
        <span className="sr-only">(nouvel onglet)</span>
      </a>
    );
  } else if (source.type === "docker") {
    detail = <span className="truncate font-mono text-xs">{`${source.image}:${source.tag}`}</span>;
  } else if (source.type === "postgres") {
    detail = <span className="truncate">{`PostgreSQL ${source.version}`}</span>;
  } else {
    detail = <span className="truncate font-mono text-xs">{source.repo}</span>;
  }

  return (
    <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center">{detail}</span>
      {source.type !== "postgres" ? (
        <>
          <span aria-hidden="true" className="text-subtle">
            ·
          </span>
          <span className="shrink-0">{typeLabel}</span>
        </>
      ) : null}
    </p>
  );
}

function ServiceMenu({ service, onDeleted }: { service: Service; onDeleted: () => void }) {
  const router = useRouter();
  const action = useServiceAction();
  const { copy } = useCopyToClipboard();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const database = useDatabaseByService(service.source.type === "postgres" ? service.id : null);
  const busy = isServiceBusy(service.status);
  const stopped = service.status === "stopped";

  async function run(kind: "start" | "stop" | "restart") {
    const done = { start: "Service démarré", stop: "Service arrêté", restart: "Redémarrage lancé" };
    try {
      await action.mutateAsync({ id: service.id, action: kind });
      toast.success(done[kind], { description: service.name });
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function copyId() {
    const copied = await copy(service.id);
    if (copied) toast.success("Identifiant copié");
    else toast.error("Impossible de copier l’identifiant");
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconAction label="Plus d’actions" size="icon">
            <MoreHorizontal />
          </IconAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {stopped ? (
            <DropdownMenuItem disabled={busy} onSelect={() => void run("start")}>
              <Play /> Démarrer
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem disabled={busy} onSelect={() => void run("restart")}>
                <RotateCw /> Redémarrer
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onSelect={() => void run("stop")}>
                <Square /> Arrêter
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onSelect={() => void copyId()}>
            <Copy /> Copier l’identifiant
          </DropdownMenuItem>
          {database.data ? (
            <DropdownMenuItem onSelect={() => router.push(routes.database(database.data.id))}>
              <Database /> Ouvrir la page de la base
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2 /> Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteServiceDialog
        service={service}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={onDeleted}
      />
    </>
  );
}

interface ServicePanelHeaderProps {
  service: Service;
  onClose: () => void;
}

export function ServicePanelHeader({ service, onClose }: ServicePanelHeaderProps) {
  const { deploy, isPending } = useServiceDeploy(service.id);
  const canDeploy = service.source.type !== "postgres";

  return (
    <header className="flex items-start gap-3 px-4 pt-4 pb-3 @md:px-6 @md:pt-5">
      <ServiceIcon type={service.source.type} tile="lg" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <EditableName key={service.name} service={service} />
          <StatusBadge kind="service" status={service.status} />
        </div>
        <Subline service={service} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {canDeploy ? (
          <Button
            size="sm"
            aria-label="Déployer"
            disabled={isPending || isServiceBusy(service.status)}
            onClick={() => void deploy("manual")}
          >
            {isPending ? <Spinner /> : <Rocket data-icon="inline-start" />}
            <span className="hidden @md:inline">Déployer</span>
          </Button>
        ) : null}
        <ServiceMenu service={service} onDeleted={onClose} />
        <IconAction label="Fermer le panneau" size="icon" onClick={onClose}>
          <X />
        </IconAction>
      </div>
    </header>
  );
}
