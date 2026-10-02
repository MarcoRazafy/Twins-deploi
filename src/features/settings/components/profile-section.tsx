"use client";

import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MEMBER_ROLE_LABELS } from "@/lib/constants";
import { useProfile, useUpdateProfile } from "@/lib/queries";
import type { UserProfile } from "@/lib/types";

import { useSettingsForm } from "../hooks/use-settings-form";
import { validateEmail, validateText } from "../lib/validation";
import { FormCard, FormCardSkeleton, FormField, QueryBoundary, describedBy } from "./form-parts";

function ProfileCard({ profile }: { profile: UserProfile }) {
  const update = useUpdateProfile();
  const form = useSettingsForm({
    initial: { name: profile.name, email: profile.email },
    validate: (values) => ({
      name: validateText(values.name, { min: 2, max: 60, label: "Le nom" }),
      email: validateEmail(values.email),
    }),
    save: (values) => update.mutateAsync({ name: values.name, email: values.email }),
    successMessage: "Profil enregistré",
  });
  const { values, errors } = form;

  return (
    <FormCard
      title="Profil"
      description="Vos informations personnelles, visibles par les membres de l’espace de travail."
      hint="L’adresse e-mail sert aux notifications."
      form={form}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <UserAvatar name={values.name.trim() || profile.name} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{values.name.trim() || "Sans nom"}</p>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant="secondary">{MEMBER_ROLE_LABELS[profile.role]}</Badge>
              <span className="text-xs text-muted-foreground">Le rôle est géré dans « Membres ».</span>
            </div>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="profile-name" label="Nom" error={errors.name}>
            <Input
              id="profile-name"
              value={values.name}
              autoComplete="name"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={describedBy("profile-name", false, errors.name)}
              onChange={(event) => form.set("name", event.target.value)}
              onBlur={() => form.blur("name")}
            />
          </FormField>
          <FormField id="profile-email" label="Adresse e-mail" error={errors.email}>
            <Input
              id="profile-email"
              type="email"
              value={values.email}
              autoComplete="email"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={describedBy("profile-email", false, errors.email)}
              onChange={(event) => form.set("email", event.target.value)}
              onBlur={() => form.blur("email")}
            />
          </FormField>
        </div>
      </div>
    </FormCard>
  );
}

export function ProfileSection() {
  const query = useProfile();
  return (
    <QueryBoundary query={query} skeleton={<FormCardSkeleton fields={2} />}>
      {(profile) => <ProfileCard key={`${profile.name}|${profile.email}`} profile={profile} />}
    </QueryBoundary>
  );
}
