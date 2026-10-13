"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock, Power, RotateCw, Settings, SquareTerminal } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { StatusDot } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { API_MODE } from "@/lib/api";
import { useServerConsole, useSession } from "@/lib/queries";
import { routes } from "@/lib/routes";
import { CONSOLE_CLOSE_MESSAGES } from "@/lib/server-console";
import type { StatusTone } from "@/lib/status";

import { TerminalPane, type TerminalEvent } from "./terminal-pane";

type Phase =
  | { kind: "connecting" }
  | { kind: "open" }
  | { kind: "closed"; message: string }
  /** The owner closed the session: nothing is mounted, nothing runs on the server. */
  | { kind: "idle" };

const REFUSED_MESSAGE =
  "Le serveur a refusé la connexion : console désactivée, session expirée, deux sessions déjà ouvertes ou service de terminal arrêté.";

const PHASE_META: Record<Phase["kind"], { label: string; tone: StatusTone; pulse: boolean }> = {
  connecting: { label: "Connexion…", tone: "info", pulse: true },
  open: { label: "Session ouverte", tone: "success", pulse: false },
  closed: { label: "Session terminée", tone: "neutral", pulse: false },
  idle: { label: "Session terminée", tone: "neutral", pulse: false },
};

function closedMessage(event: Extract<TerminalEvent, { type: "closed" }>): string {
  if (!event.wasOpen && event.reason === "disconnected") return REFUSED_MESSAGE;
  if (event.reason === "shellExited" && event.exitCode !== null && event.exitCode !== 0) {
    return `Le shell s’est terminé (code ${event.exitCode}).`;
  }
  return CONSOLE_CLOSE_MESSAGES[event.reason];
}

function Terminal() {
  /** A new attempt remounts the pane: a new connection, a new shell. */
  const [attempt, setAttempt] = useState(1);
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const meta = PHASE_META[phase.kind];

  function handleEvent(event: TerminalEvent) {
    setPhase(event.type === "open" ? { kind: "open" } : { kind: "closed", message: closedMessage(event) });
  }

  function reopen() {
    setPhase({ kind: "connecting" });
    setAttempt((current) => current + 1);
  }

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Console du serveur">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2">
        <h1 className="text-sm font-medium">Console du serveur</h1>
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <StatusDot tone={meta.tone} pulse={meta.pulse} />
          {meta.label}
        </p>
        <p className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground md:block">
          Shell du compte de la plateforme, sans droits root. La session se termine si vous quittez cette page.
        </p>
        <div className="ml-auto flex items-center gap-2">
          {phase.kind === "open" || phase.kind === "connecting" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setPhase({ kind: "idle" })}>
              <Power data-icon="inline-start" />
              Fermer la session
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={reopen}>
              <RotateCw data-icon="inline-start" />
              Nouvelle session
            </Button>
          )}
        </div>
      </header>

      {phase.kind === "closed" ? (
        <p role="alert" className="shrink-0 border-b bg-secondary px-4 py-2 text-sm text-muted-foreground">
          {phase.message}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 bg-background p-2">
        {phase.kind === "idle" ? (
          <EmptyState
            compact
            icon={SquareTerminal}
            title="Session fermée"
            description="Le shell et tout ce qu’il avait lancé sont arrêtés sur le serveur."
            action={
              <Button type="button" onClick={reopen}>
                <RotateCw data-icon="inline-start" />
                Nouvelle session
              </Button>
            }
          />
        ) : (
          <TerminalPane key={attempt} onEvent={handleEvent} />
        )}
      </div>
    </section>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex h-full w-full max-w-2xl flex-col justify-center px-4 py-10">{children}</div>;
}

export function ServerConsoleView() {
  const session = useSession();
  const isOwner = session.data?.user?.role === "owner";
  const available = API_MODE === "http";
  const status = useServerConsole({ enabled: available && isOwner });

  if (!available) {
    return (
      <Notice>
        <EmptyState
          icon={SquareTerminal}
          title="Console indisponible dans le simulateur"
          description="La console ouvre un terminal sur le serveur : elle n’existe que sur une vraie installation."
        />
      </Notice>
    );
  }
  if (session.isPending) return <PageSkeleton variant="table" />;
  if (!isOwner) {
    return (
      <Notice>
        <EmptyState
          icon={Lock}
          title="Réservée au propriétaire"
          description="La console donne un terminal sur le serveur lui-même. Seul le compte propriétaire peut l’ouvrir."
        />
      </Notice>
    );
  }
  if (status.isError) {
    return (
      <Notice>
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      </Notice>
    );
  }
  if (status.data === undefined) return <PageSkeleton variant="table" />;
  if (!status.data.enabled) {
    return (
      <Notice>
        <EmptyState
          icon={SquareTerminal}
          title="La console du serveur est désactivée"
          description="Elle ouvre un terminal interactif sur le serveur, pour l’administrer ou lancer Claude Code depuis le navigateur. Activez-la dans les Settings quand vous en avez besoin."
          action={
            <Button asChild>
              <Link href={routes.settings("console")}>
                <Settings data-icon="inline-start" />
                Ouvrir les Settings
              </Link>
            </Button>
          }
        />
      </Notice>
    );
  }
  return <Terminal />;
}
