"use client";

import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";

import { QUICK_CREATE_ACTIONS } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** "Nouveau" menu of the top bar: every creation flow of the platform. */
export function QuickCreateMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" aria-label="Nouveau" className="max-sm:size-8 max-sm:px-0">
          <Plus data-icon="inline-start" />
          <span className="max-sm:hidden">Nouveau</span>
          <ChevronDown data-icon="inline-end" className="text-muted-foreground max-sm:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={12} className="w-64">
        <DropdownMenuLabel>Créer</DropdownMenuLabel>
        <DropdownMenuGroup>
          {QUICK_CREATE_ACTIONS.map(({ id, label, href, icon: Icon }) => (
            <DropdownMenuItem key={id} asChild>
              <Link href={href}>
                <Icon />
                {label}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
