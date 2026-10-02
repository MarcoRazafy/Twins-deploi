"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { ErrorState } from "@/components/shared/error-state";
import { LogoMark } from "@/components/shared/logo";
import { Spinner } from "@/components/ui/spinner";
import { API_MODE } from "@/lib/api";
import { useSession } from "@/lib/queries";

import { loginHref, SETUP_PATH } from "../lib/paths";

function GateScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">{children}</div>
  );
}

function GateLoading({ label }: { label: string }) {
  return (
    <GateScreen>
      <div role="status" className="flex flex-col items-center gap-5">
        <LogoMark className="size-11" />
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner role="presentation" aria-hidden="true" />
          {label}
        </p>
      </div>
    </GateScreen>
  );
}

/**
 * The gate proper. The session is an ordinary client-side query, so the routes
 * behind it stay static: the server HTML is the loading screen, and the page
 * appears once the session is known.
 */
export function HttpSessionGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data, isError, isFetching, error, refetch } = useSession();
  const status = data?.status;

  useEffect(() => {
    if (status === "unauthenticated") {
      // Read here rather than with useSearchParams, which would force a Suspense boundary above the shell.
      router.replace(loginHref(window.location.pathname + window.location.search));
    } else if (status === "setup_required") {
      router.replace(SETUP_PATH);
    }
  }, [status, router]);

  // A background refresh that fails must not tear down a page the user is working on.
  if (status === "authenticated") return <>{children}</>;

  if (status === undefined && isError && !isFetching) {
    return (
      <GateScreen>
        <ErrorState
          className="w-full max-w-md"
          title="Impossible de vérifier la session"
          error={error}
          onRetry={() => void refetch()}
        />
      </GateScreen>
    );
  }

  return <GateLoading label={status === undefined ? "Vérification de la session…" : "Redirection…"} />;
}

/**
 * Keeps every platform route behind a signed-in session. Against the simulator
 * (everyone is signed in) it renders its children as they are, so there is no
 * loading screen and no extra request.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  if (API_MODE === "mock") return <>{children}</>;
  return <HttpSessionGate>{children}</HttpSessionGate>;
}
