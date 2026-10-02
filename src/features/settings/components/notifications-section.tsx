"use client";

import { Separator } from "@/components/ui/separator";
import { useSettings, useUpdateSettings } from "@/lib/queries";
import type { PlatformSettings } from "@/lib/types";

import { useSettingsForm } from "../hooks/use-settings-form";
import { FormCard, FormCardSkeleton, QueryBoundary, SwitchRow } from "./form-parts";

type EventKey = "deploySucceeded" | "deployFailed" | "serviceCrashed" | "domainIssues" | "weeklyDigest";

const EVENTS: ReadonlyArray<{ key: EventKey; label: string; description: string }> = [
  { key: "deploySucceeded", label: "Déploiement réussi", description: "Une version est en ligne." },
  { key: "deployFailed", label: "Déploiement échoué", description: "Un build ou un déploiement a échoué." },
  { key: "serviceCrashed", label: "Service en erreur", description: "Un service s’est arrêté de façon inattendue." },
  { key: "domainIssues", label: "Problèmes de domaine", description: "DNS non résolu, certificat SSL en échec ou expirant." },
  { key: "weeklyDigest", label: "Résumé hebdomadaire", description: "Un bilan de l’activité, chaque lundi matin." },
];

function NotificationsCard({ settings }: { settings: PlatformSettings }) {
  const update = useUpdateSettings();
  const form = useSettingsForm({
    initial: { ...settings.notifications },
    validate: () => ({}),
    save: (values) => update.mutateAsync({ notifications: values }),
    successMessage: "Préférences de notification enregistrées",
  });
  const { values } = form;
  const noChannel = !values.email && !values.inApp;

  return (
    <FormCard
      title="Notifications"
      description="Choisissez les événements à suivre et où les recevoir."
      hint={noChannel ? "Aucun canal actif : vous ne recevrez rien." : "Les changements s’appliquent à tous vos projets."}
      form={form}
    >
      <div className="space-y-5">
        <div className="space-y-4">
          <h3 className="text-xs font-medium text-muted-foreground">Événements</h3>
          {EVENTS.map((event) => (
            <SwitchRow
              key={event.key}
              id={`notif-${event.key}`}
              label={event.label}
              description={event.description}
              checked={values[event.key]}
              onCheckedChange={(checked) => form.set(event.key, checked)}
            />
          ))}
        </div>
        <Separator />
        <div className="space-y-4">
          <h3 className="text-xs font-medium text-muted-foreground">Canaux</h3>
          <SwitchRow
            id="notif-email"
            label="E-mail"
            description="Envoyé à l’adresse de votre profil."
            checked={values.email}
            onCheckedChange={(checked) => form.set("email", checked)}
          />
          <SwitchRow
            id="notif-inApp"
            label="Dans l’application"
            description="Affiché dans la cloche de la barre supérieure."
            checked={values.inApp}
            onCheckedChange={(checked) => form.set("inApp", checked)}
          />
        </div>
      </div>
    </FormCard>
  );
}

export function NotificationsSection() {
  const query = useSettings();
  return (
    <QueryBoundary query={query} skeleton={<FormCardSkeleton fields={5} />}>
      {(settings) => <NotificationsCard key={JSON.stringify(settings.notifications)} settings={settings} />}
    </QueryBoundary>
  );
}
