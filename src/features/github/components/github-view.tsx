"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { GithubIcon } from "@/components/icons/brand-icons";
import { ErrorState } from "@/components/shared/error-state";
import { FadeIn } from "@/components/shared/motion";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryParam } from "@/hooks/use-query-param";
import { API_MODE } from "@/lib/api";
import { useGithubConnection } from "@/lib/queries";
import type { GithubRepo } from "@/lib/types";

import { ConnectGithubDialog } from "./connect-github-dialog";
import { ConnectedServices } from "./connected-services";
import { GithubAccountCard } from "./github-account-card";
import { GithubOnboarding } from "./github-onboarding";
import { ImportRepoDialog } from "./import-repo-dialog";
import { RepoBrowser } from "./repo-browser";

function GithubViewSkeleton() {
  return (
    <div aria-busy className="space-y-6">
      <Skeleton className="h-36 w-full rounded-xl" />
      <div className="space-y-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-full max-w-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** /github: connect an account, browse repositories, tune the connected services. */
export function GithubView() {
  const connection = useGithubConnection();
  const [newParam, setNewParam] = useQueryParam("new");
  const [manualImport, setManualImport] = useState<{ open: boolean; repo: GithubRepo | null }>({
    open: false,
    repo: null,
  });
  const [connectOpen, setConnectOpen] = useState(false);

  const data = connection.data;
  const connected = data?.connected === true;
  // Without an account, only the real backend can import (public repositories, read with git).
  const publicImport = API_MODE === "http" && data?.connected === false;
  // `?new=1` opens the dialog on arrival; closing it removes the parameter.
  const importOpen = manualImport.open || newParam === "1";

  function openImport(repo: GithubRepo | null) {
    setManualImport({ open: true, repo });
  }

  function handleImportOpenChange(open: boolean) {
    if (open) {
      setManualImport((current) => ({ ...current, open: true }));
      return;
    }
    setManualImport((current) => ({ ...current, open: false }));
    if (newParam !== null) setNewParam(null);
  }

  let body;
  if (connection.isPending) {
    body = <GithubViewSkeleton />;
  } else if (connection.isError || !data) {
    body = (
      <ErrorState
        title="Impossible de charger la connexion GitHub"
        error={connection.error}
        onRetry={() => {
          void connection.refetch();
        }}
      />
    );
  } else if (!connected) {
    body = (
      <FadeIn key="onboarding" className="space-y-8">
        <GithubOnboarding onConnect={() => setConnectOpen(true)} />
        {/* The real backend deploys public repositories without an account: those services stay manageable here. */}
        {publicImport ? <ConnectedServices onImport={() => openImport(null)} /> : null}
      </FadeIn>
    );
  } else {
    body = (
      <FadeIn key="connected" className="space-y-8">
        <GithubAccountCard connection={data} />
        <RepoBrowser connection={data} onImport={openImport} />
        <ConnectedServices onImport={() => openImport(null)} />
      </FadeIn>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="GitHub"
        icon={GithubIcon}
        description="Importez vos dépôts et choisissez la branche déployée à chaque push."
        actions={
          connected || publicImport ? (
            <Button type="button" variant={connected ? "default" : "outline"} onClick={() => openImport(null)}>
              <Download data-icon="inline-start" />
              {connected ? "Importer un dépôt" : "Importer un dépôt public"}
            </Button>
          ) : undefined
        }
      />
      {body}
      <ConnectGithubDialog open={connectOpen} onOpenChange={setConnectOpen} />
      {data ? (
        <ImportRepoDialog
          open={importOpen}
          onOpenChange={handleImportOpenChange}
          defaultRepo={manualImport.repo}
        />
      ) : null}
    </PageContainer>
  );
}
