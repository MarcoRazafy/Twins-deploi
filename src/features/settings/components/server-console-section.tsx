"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Info, SquareTerminal, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { API_MODE } from "@/lib/api";
import { isApiError } from "@/lib/api/contract";
import { formatDateTime } from "@/lib/format";
import { useServerConsole, useSession, useSetServerConsole } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { CONSOLE_LIMITS } from "@/lib/server-console";
import type { ServerConsoleStatus } from "@/lib/types";

import { notifyError } from "../lib/errors";
import { FormField, QueryBoundary, SwitchRow, describedBy } from "./form-parts";

const TITLE = "Console du serveur";
const DESCRIPTION =
  "Un terminal interactif sur le serveur lui-même, depuis l’entrée « Console » de la barre latérale : pour l’administrer ou y lancer Claude Code.";
const IDLE_MINUTES = CONSOLE_LIMITS.idleTimeoutMs / 60_000;

function Note({ tone, children }: { tone: "info" | "warning"; children: React.ReactNode }) {
  const Icon = tone === "warning" ? TriangleAlert : Info;
  return (
    <div
      className={
        tone === "warning"
          ? "flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2.5 text-sm text-warning"
          : "flex items-start gap-2 rounded-lg bg-secondary px-3 py-2.5 text-sm text-muted-foreground"
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">{children}</div>
    </div>
  );
}

interface EnableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Turning the console on asks for the password again: a session left open is not enough. */
function EnableDialog({ open, onOpenChange }: EnableDialogProps) {
  const setConsole = useSetServerConsole();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();

  function close(next: boolean) {
    if (setConsole.isPending) return;
    if (!next) {
      setPassword("");
      setError(undefined);
    }
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) {
      setError("Saisissez votre mot de passe.");
      return;
    }
    try {
      await setConsole.mutateAsync({ enabled: true, password });
      toast.success("Console du serveur activée");
      setPassword("");
      setError(undefined);
      onOpenChange(false);
    } catch (failure) {
      if (isApiError(failure) && failure.field === "password") setError(failure.message);
      else notifyError(failure);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form noValidate onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Activer la console du serveur</DialogTitle>
            <DialogDescription>
              Tant qu’elle est activée, votre compte ouvre un terminal sur le serveur depuis le navigateur.
              Confirmez avec votre mot de passe.
            </DialogDescription>
          </DialogHeader>
          <Note tone="warning">
            <p>
              Quiconque accède à votre compte obtient alors un shell sur ce serveur. Désactivez la console dès que
              vous n’en avez plus besoin.
            </p>
          </Note>
          <FormField id="console-password" label="Mot de passe" error={error}>
            <Input
              id="console-password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy("console-password", false, error)}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error) setError(undefined);
              }}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={setConsole.isPending}>
              Annuler
            </Button>
            <Button type="submit" disabled={setConsole.isPending}>
              {setConsole.isPending ? <Spinner data-icon="inline-start" /> : null}
              Activer la console
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConsoleCard({ status }: { status: ServerConsoleStatus }) {
  const setConsole = useSetServerConsole();
  const [dialogOpen, setDialogOpen] = useState(false);

  async function handleToggle(checked: boolean) {
    if (checked) {
      setDialogOpen(true);
      return;
    }
    try {
      await setConsole.mutateAsync({ enabled: false });
      toast.success("Console du serveur désactivée", { description: "Les sessions ouvertes sont fermées." });
    } catch (failure) {
      notifyError(failure);
    }
  }

  return (
    <SectionCard
      title={TITLE}
      description={DESCRIPTION}
      actions={
        status.enabled ? (
          <Button asChild variant="outline">
            <Link href={routes.serverConsole()}>
              <SquareTerminal data-icon="inline-start" />
              Ouvrir la console
            </Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        <SwitchRow
          id="server-console-enabled"
          label="Autoriser la console du serveur"
          description={
            status.updatedAt && status.updatedBy
              ? `${status.enabled ? "Activée" : "Désactivée"} le ${formatDateTime(status.updatedAt)} par ${status.updatedBy}.`
              : "Désactivée par défaut."
          }
          checked={status.enabled}
          onCheckedChange={(checked) => void handleToggle(checked)}
          disabled={setConsole.isPending}
        />
        <Note tone="warning">
          <p>
            La console est un accès complet au serveur, protégé seulement par votre mot de passe. Laissez-la
            désactivée hors des moments où vous vous en servez.
          </p>
        </Note>
        <Note tone="info">
          <ul className="list-disc space-y-1 pl-4">
            <li>Réservée au compte propriétaire, depuis une session du navigateur (pas avec un jeton d’API).</li>
            <li>Le shell utilise le compte de la plateforme, sans droits root ni sudo.</li>
            <li>
              {CONSOLE_LIMITS.maxSessions} sessions au plus ; une session se ferme après {IDLE_MINUTES} minutes sans
              saisie ou quand vous vous déconnectez. Quitter la page ne la ferme pas : vous la reprenez en revenant.
            </li>
            <li>Chaque ouverture et chaque fermeture est inscrite dans l’activité, avec le compte et l’adresse IP.</li>
          </ul>
        </Note>
      </div>
      <EnableDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </SectionCard>
  );
}

export function ServerConsoleSection() {
  const session = useSession();
  const isOwner = session.data?.user?.role === "owner";
  const available = API_MODE === "http";
  const status = useServerConsole({ enabled: available && isOwner });

  if (!available || (!session.isPending && !isOwner)) {
    return (
      <SectionCard title={TITLE} description={DESCRIPTION}>
        <Note tone="info">
          <p>
            {available
              ? "Seul le compte propriétaire peut activer et utiliser la console du serveur."
              : "La console n’existe que sur une vraie installation : le simulateur n’a pas de serveur."}
          </p>
        </Note>
      </SectionCard>
    );
  }

  return (
    <QueryBoundary query={status} skeleton={<Skeleton className="h-64 rounded-xl" />}>
      {(data) => <ConsoleCard status={data} />}
    </QueryBoundary>
  );
}
