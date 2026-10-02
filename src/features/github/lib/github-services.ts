import type { GithubSource, Service } from "@/lib/types";

/** A service deployed from a GitHub repository (`source` narrowed). */
export type GithubService = Service & { source: GithubSource };

export function isGithubService(service: Service): service is GithubService {
  return service.source.type === "github";
}

/** Services grouped by "owner/name": one repository can feed several services. */
export function groupServicesByRepo(
  services: readonly GithubService[],
): Map<string, GithubService[]> {
  const byRepo = new Map<string, GithubService[]>();
  for (const service of services) {
    const group = byRepo.get(service.source.repo);
    if (group) group.push(service);
    else byRepo.set(service.source.repo, [service]);
  }
  return byRepo;
}
