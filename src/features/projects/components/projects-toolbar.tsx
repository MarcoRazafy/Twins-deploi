"use client";

import { ArrowUpDown, LayoutGrid, List } from "lucide-react";

import { SearchInput } from "@/components/shared/search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import type { ProjectsViewMode } from "../hooks/use-projects-view-mode";
import {
  PROJECT_SORT_LABELS,
  PROJECT_SORTS,
  parseProjectSort,
  type ProjectSort,
} from "../lib/project-list";

interface ProjectsToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  sort: ProjectSort;
  onSortChange: (sort: ProjectSort) => void;
  view: ProjectsViewMode;
  onViewChange: (view: ProjectsViewMode) => void;
  /** Search and sort are meaningless while there is nothing to search yet. */
  disabled?: boolean;
}

const VIEW_OPTIONS = [
  { value: "grid", label: "Vue en grille", icon: LayoutGrid },
  { value: "list", label: "Vue en liste", icon: List },
] as const satisfies ReadonlyArray<{
  value: ProjectsViewMode;
  label: string;
  icon: typeof LayoutGrid;
}>;

export function ProjectsToolbar({
  query,
  onQueryChange,
  sort,
  onSortChange,
  view,
  onViewChange,
  disabled = false,
}: ProjectsToolbarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <SearchInput
        value={query}
        onChange={onQueryChange}
        placeholder="Rechercher un projet"
        label="Rechercher un projet par nom ou description"
        disabled={disabled}
        className="sm:w-72"
      />

      <div className="flex items-center gap-2 sm:ml-auto">
        <Select
          value={sort}
          disabled={disabled}
          onValueChange={(value) => {
            const next = parseProjectSort(value);
            if (next) onSortChange(next);
          }}
        >
          <SelectTrigger aria-label="Trier par" className="min-w-0 flex-1 sm:w-56 sm:flex-none">
            <span className="flex min-w-0 items-center gap-2">
              <ArrowUpDown aria-hidden="true" className="text-muted-foreground" />
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent>
            {PROJECT_SORTS.map((value) => (
              <SelectItem key={value} value={value}>
                {PROJECT_SORT_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ToggleGroup
          type="single"
          value={view}
          spacing={1}
          aria-label="Mode d’affichage"
          onValueChange={(value) => {
            // Radix reports "" when the pressed item is pressed again: keep the mode.
            if (value === "grid" || value === "list") onViewChange(value);
          }}
        >
          {VIEW_OPTIONS.map(({ value, label, icon: Icon }) => (
            <Tooltip key={value}>
              {/* The tooltip trigger is a wrapper: both Radix triggers write
                  `data-state` on their element and would overwrite each other. */}
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <ToggleGroupItem
                    value={value}
                    aria-label={label}
                    className="text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground"
                  >
                    <Icon />
                  </ToggleGroupItem>
                </span>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}
