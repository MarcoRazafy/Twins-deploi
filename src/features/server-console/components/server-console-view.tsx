"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Lock, Plus, Power, RotateCw, Settings, SquareTerminal } from "lucide-react";

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

import { TerminalPane, type TerminalEvent, type TerminalPaneHandle } from "./terminal-pane";

type Phase =
  | { kind: "connecting" }
  | { kind: "open"; resumed: boolean }
  /** `resumable`: only the connection ended, the shell may still be running on the server. */
  | { kind: "closed"; message: string; resumable: boolean }
  /** The owner closed the session: nothing is mounted, nothing runs on the server. */
  | { kind: "idle" };

const REFUSED_MESSAGE =
  "Le serveur a refusé la connexion : console désactivée, session expirée, deux sessions déjà ouvertes ou service de terminal arrêté.";

function phaseMeta(phase: Phase): { label: string; tone: StatusTone; pulse: boolean } {
  switch (phase.kind) {
    case "connecting":
      return { label: "Connexion…", tone: "info", pulse: true };
    case "open":
      return { label: phase.resumed ? "Session reprise" : "Session ouverte", tone: "success", pulse: false };
    case "closed":
      return phase.resumable
        ? { label: "Déconnectée", tone: "warning", pulse: false }
        : { label: "Session terminée", tone: "neutral", pulse: false };
    case "idle":
      return { label: "Session terminée", tone: "neutral", pulse: false };
  }
}

/**
 * Terminal this tab was last attached to. Module state: it outlives the page
 * when the owner navigates elsewhere in the application and comes back.
 */
let lastSessionId: string | null = null;

function closedMessage(event: Extract<TerminalEvent, { type: "closed" }>): string {
  if (!event.wasOpen && event.reason === "disconnected") return REFUSED_MESSAGE;
  if (event.reason === "shellExited" && event.exitCode !== null && event.exitCode !== 0) {
    return `Le shell s’est terminé (code ${event.exitCode}).`;
  }
  return CONSOLE_CLOSE_MESSAGES[event.reason];
}

function Terminal() {
  /** A new attempt remounts the pane: a new connection, to the same terminal unless `fresh`. */
  const [attempt, setAttempt] = useState({ count: 1, fresh: false });
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const pane = useRef<TerminalPaneHandle>(null);
  const meta = phaseMeta(phase);

  function handleEvent(event: TerminalEvent) {
    if (event.type === "open") {
      lastSessionId = event.sessionId;
      setPhase({ kind: "open", resumed: event.resumed });
      return;
    }
    // Only a lost connection leaves the shell running: anything else ended it, or gave it to another tab.
    const resumable = event.wasOpen && (event.reason === "disconnected" || event.reason === "takenOver");
    if (!resumable) lastSessionId = null;
    setPhase({ kind: "closed", message: closedMessage(event), resumable });
  }

  function reopen(fresh: boolean) {
    setPhase({ kind: "connecting" });
    setAttempt((current) => ({ count: current.count + 1, fresh }));
  }

  function close() {
    pane.current?.end();
    lastSessionId = null;
    setPhase({ kind: "idle" });
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
          Shell du compte de la plateforme, sans droits root. La session continue si vous quittez cette page, et se
          ferme après 30 minutes sans saisie.
        </p>
        <div className="ml-auto flex items-center gap-2">
          {phase.kind === "open" || phase.kind === "connecting" ? (
            <Button type="button" variant="outline" size="sm" onClick={close}>
              <Power data-icon="inline-start" />
              Fermer la session
            </Button>
          ) : phase.kind === "closed" && phase.resumable ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => reopen(true)}>
                <Plus data-icon="inline-start" />
                Nouvelle session
              </Button>
              <Button type="button" size="sm" onClick={() => reopen(false)}>
                <RotateCw data-icon="inline-start" />
                Reprendre la session
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" onClick={() => reopen(true)}>
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
              <Button type="button" onClick={() => reopen(true)}>
                <RotateCw data-icon="inline-start" />
                Nouvelle session
              </Button>
            }
          />
        ) : (
          <TerminalPane
            key={attempt.count}
            ref={pane}
            sessionId={lastSessionId}
            fresh={attempt.fresh}
            onEvent={handleEvent}
          />
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
