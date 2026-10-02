import { REGION_LABELS } from "@/lib/constants";
import type { ProjectSummary, Region } from "@/lib/types";

export const PROJECT_SORTS = ["recent", "name", "services"] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export const PROJECT_SORT_LABELS: Record<ProjectSort, string> = {
  recent: "Activité récente",
  name: "Nom",
  services: "Nombre de services",
};

export function parseProjectSort(value: string): ProjectSort | null {
  return PROJECT_SORTS.find((sort) => sort === value) ?? null;
}

/** Lower-cased and accent-free, so that "ete" finds "Été". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function filterProjects(
  projects: readonly ProjectSummary[],
  query: string,
): readonly ProjectSummary[] {
  const needle = fold(query.trim());
  if (!needle) return projects;
  return projects.filter((project) =>
    fold(`${project.name} ${project.description}`).includes(needle),
  );
}

/** Last time something happened in the project: a deployment or an edit. */
function lastActivity(project: ProjectSummary): number {
  const edited = Date.parse(project.updatedAt);
  const deployed = project.lastDeployment ? Date.parse(project.lastDeployment.createdAt) : 0;
  return Math.max(edited, deployed);
}

function byName(a: ProjectSummary, b: ProjectSummary): number {
  return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
}

/** Returns a new array: the list from the query cache is never reordered in place. */
export function sortProjects(
  projects: readonly ProjectSummary[],
  sort: ProjectSort,
): ProjectSummary[] {
  const sorted = [...projects];
  switch (sort) {
    case "name":
      return sorted.sort(byName);
    case "services":
      return sorted.sort((a, b) => b.stats.services - a.stats.services || byName(a, b));
    case "recent":
      return sorted.sort((a, b) => lastActivity(b) - lastActivity(a) || byName(a, b));
  }
}

/** "Europe de l'Ouest · Paris" → "Paris": the short form for dense tables. */
export function regionCity(region: Region): string {
  const label = REGION_LABELS[region];
  const [, city] = label.split(" · ");
  return city ?? label;
}
