import { FeaturePlaceholder } from "@/components/shared/feature-placeholder";

/** Full-bleed canvas of one project: service cards, connections, zoom/pan. */
export function WorkspaceView({ projectId }: { projectId: string }) {
  return <FeaturePlaceholder name={`Workspace ${projectId}`} />;
}

/** `/workspace`: sends the user to the last opened project (or a picker). */
export function WorkspaceIndexView() {
  return <FeaturePlaceholder name="Workspace" />;
}
