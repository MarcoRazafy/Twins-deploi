"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Ellipsis, Pencil, Settings2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { routes } from "@/lib/routes";
import type { ProjectSummary } from "@/lib/types";

import { DeleteProjectConfirm } from "./delete-project-dialog";
import { RenameProjectDialog } from "./rename-project-dialog";

interface ProjectActionsMenuProps {
  project: ProjectSummary;
  className?: string;
}

/**
 * The "…" menu of a project, shared by the cards and the table rows. It hosts
 * its own dialogs, so the same behaviour works wherever a project is listed.
 */
export function ProjectActionsMenu({ project, className }: ProjectActionsMenuProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      {/* Non-modal: a modal menu and the dialog it opens fight over the page's
          pointer events and can leave the page unclickable once the dialog closes. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={className}
            aria-label={`Actions du projet ${project.name}`}
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild>
            <Link href={routes.workspace(project.id)}>
              <ArrowUpRight />
              Ouvrir le workspace
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={routes.projectSettings(project.id)}>
              <Settings2 />
              Réglages
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <Pencil />
            Renommer
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2 />
            Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameProjectDialog project={project} open={renameOpen} onOpenChange={setRenameOpen} />
      <DeleteProjectConfirm
        project={project}
        stats={project.stats}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
}
