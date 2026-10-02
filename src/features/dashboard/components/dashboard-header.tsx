"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { GithubIcon } from "@/components/icons/brand-icons";
import { PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { useProfile } from "@/lib/queries";
import { routes } from "@/lib/routes";

import { formatLongDate, getFirstName, getGreeting } from "../lib/greeting";

export interface DashboardHeaderProps {
  onCreateProject: () => void;
}

/** Greeting by the hour, today's date and the two entry points to a new service. */
export function DashboardHeader({ onCreateProject }: DashboardHeaderProps) {
  // 0 on the server and while hydrating: the placeholders below keep the line
  // heights so the real text replaces them without a jump.
  const now = useNow(60_000);
  const profile = useProfile();
  const firstName = getFirstName(profile.data?.name);
  const greeting = now > 0 ? getGreeting(now) : null;

  return (
    <PageHeader
      title={
        greeting ? (
          firstName ? (
            `${greeting}, ${firstName}`
          ) : (
            greeting
          )
        ) : (
          <span aria-hidden="true" className="invisible">
            Bonjour
          </span>
        )
      }
      description={now > 0 ? formatLongDate(now) : " "}
      actions={
        <>
          <Button asChild variant="outline" className="max-sm:h-10">
            <Link href={routes.github({ new: true })}>
              <GithubIcon data-icon="inline-start" />
              Importer un dépôt
            </Link>
          </Button>
          <Button type="button" className="max-sm:h-10" onClick={onCreateProject}>
            <Plus data-icon="inline-start" />
            Nouveau projet
          </Button>
        </>
      }
    />
  );
}
