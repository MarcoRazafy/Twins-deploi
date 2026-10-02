"use client";

import { useState } from "react";
import { Cpu, HardDrive, Layers, Rocket } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { DockerIcon } from "@/components/icons/brand-icons";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { StatCard } from "@/components/shared/stat-card";
import { UnderlineTabs } from "@/components/shared/underline-tabs";
import { Button } from "@/components/ui/button";
import { useQueryParam } from "@/hooks/use-query-param";
import { formatMegabytes, formatPercent } from "@/lib/format";
import { DURATION, EASE } from "@/lib/motion";
import { useContainers, useDockerImages } from "@/lib/queries";

import { summarizeContainers } from "../lib/container-stats";
import { ContainersPanel } from "./containers-panel";
import { DeployImageDialog } from "./deploy-image-dialog";
import { ImagesPanel } from "./images-panel";

type DockerTab = "containers" | "images";

/** /docker: live containers with their metrics, and the local image store. */
export function DockerView() {
  const containers = useContainers();
  const images = useDockerImages();
  const [tabParam, setTabParam] = useQueryParam("tab");
  const [newParam, setNewParam] = useQueryParam("new");
  const [projectParam] = useQueryParam("project");
  const [manualOpen, setManualOpen] = useState(false);

  const tab: DockerTab = tabParam === "images" ? "images" : "containers";
  // `?new=1` opens the dialog on arrival; closing it removes the parameter.
  const deployOpen = manualOpen || newParam === "1";

  function handleDeployOpenChange(open: boolean) {
    setManualOpen(open);
    if (!open && newParam !== null) setNewParam(null);
  }

  const totals = summarizeContainers(containers.data ?? []);
  const imageList = images.data ?? [];
  const imagesSize = imageList.reduce((sum, image) => sum + image.sizeMb, 0);
  const statsLoading = containers.isPending;
  const showStats = !containers.isError || containers.data !== undefined;

  return (
    <PageContainer>
      <PageHeader
        title="Docker"
        icon={DockerIcon}
        description="Suivez vos conteneurs en direct, gérez leur cycle de vie et les images stockées sur le serveur."
        actions={
          <Button type="button" onClick={() => setManualOpen(true)}>
            <Rocket data-icon="inline-start" />
            Déployer une image
          </Button>
        }
      />

      {showStats ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Conteneurs actifs"
            icon={DockerIcon}
            tone="success"
            loading={statsLoading}
            value={totals.running}
            format={(value) => `${Math.round(value)} / ${totals.total}`}
            hint="en cours d’exécution"
          />
          <StatCard
            label="CPU cumulé"
            icon={Cpu}
            tone="brand"
            loading={statsLoading}
            value={totals.cpuPercent}
            format={(value) => formatPercent(value, 1)}
            hint="somme des conteneurs"
          />
          <StatCard
            label="Mémoire utilisée"
            icon={HardDrive}
            tone="info"
            loading={statsLoading}
            value={totals.memoryUsageMb}
            format={formatMegabytes}
            hint={`sur ${formatMegabytes(totals.memoryLimitMb)} alloués`}
          />
          <StatCard
            label="Images"
            icon={Layers}
            loading={images.isPending}
            value={imageList.length}
            hint={`${formatMegabytes(imagesSize)} au total`}
          />
        </div>
      ) : null}

      <div className="space-y-4">
        <UnderlineTabs<DockerTab>
          label="Sections Docker"
          value={tab}
          onValueChange={(value) => setTabParam(value === "containers" ? null : value)}
          tabs={[
            { value: "containers", label: "Conteneurs", count: containers.data?.length },
            { value: "images", label: "Images", count: images.data?.length },
          ]}
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } }}
            exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
          >
            {tab === "containers" ? (
              <ContainersPanel onDeploy={() => setManualOpen(true)} />
            ) : (
              <ImagesPanel />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <DeployImageDialog
        open={deployOpen}
        onOpenChange={handleDeployOpenChange}
        defaultProjectId={projectParam ?? undefined}
      />
    </PageContainer>
  );
}
