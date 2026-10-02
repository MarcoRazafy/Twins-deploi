"use client";

import { AnimatePresence, motion } from "motion/react";

import { PageContainer, PageHeader } from "@/components/shared/page";
import { useQueryParam } from "@/hooks/use-query-param";
import { fadeUp } from "@/lib/motion";
import type { SettingsSection } from "@/lib/routes";

import { parseSection } from "../lib/sections";
import { DangerSection } from "./danger-section";
import { GeneralSection } from "./general-section";
import { InfrastructureSection } from "./infrastructure-section";
import { IntegrationsSection } from "./integrations-section";
import { MembersSection } from "./members-section";
import { NotificationsSection } from "./notifications-section";
import { ProfileSection } from "./profile-section";
import { ProjectsSection } from "./projects-section";
import { SettingsNav } from "./settings-nav";
import { TokensSection } from "./tokens-section";

function SectionContent({ section }: { section: SettingsSection }) {
  switch (section) {
    case "general":
      return <GeneralSection />;
    case "profile":
      return <ProfileSection />;
    case "projects":
      return <ProjectsSection />;
    case "members":
      return <MembersSection />;
    case "tokens":
      return <TokensSection />;
    case "integrations":
      return <IntegrationsSection />;
    case "infrastructure":
      return <InfrastructureSection />;
    case "notifications":
      return <NotificationsSection />;
    case "danger":
      return <DangerSection />;
  }
}

export function SettingsView() {
  const [param, setParam] = useQueryParam("section");
  const section = parseSection(param);

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Configurez votre espace de travail, vos projets, vos accès et l’infrastructure de la plateforme."
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
        <SettingsNav value={section} onChange={(next) => setParam(next === "general" ? null : next)} />
        <div className="min-w-0 max-w-4xl">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={section} variants={fadeUp} initial="hidden" animate="visible" exit="exit">
              <SectionContent section={section} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </PageContainer>
  );
}
