/**
 * Variables the platform provides to every container, the way Railway hands
 * `RAILWAY_*` to its services. They are computed, never stored: an application
 * reads them from its environment (`process.env.TWINS_PUBLIC_DOMAIN`) or another
 * service references them (`${{MonApp.TWINS_PUBLIC_DOMAIN}}`). A user variable
 * may not take one of these names.
 */

export const BUILTIN_VARIABLE_PREFIX = "TWINS_";

/** Suffix of the name a service answers to on the private network of its project. */
export const PRIVATE_DOMAIN_SUFFIX = "twinsdeploi.internal";

export interface BuiltinVariable {
  key: string;
  value: string;
  /** French, shown in the interface. */
  description: string;
}

export interface BuiltinVariableSource {
  project: { id: string; name: string; slug: string; environment: string; region: string };
  service: {
    id: string;
    name: string;
    slug: string;
    port: number;
    volume: { name: string; mountPath: string } | null;
  };
  /** Public hostname of the service, null while none is active. */
  publicDomain: string | null;
  /** Known inside a deployment only. */
  deploymentId: string | null;
}

export function privateDomainOf(serviceSlug: string): string {
  return `${serviceSlug}.${PRIVATE_DOMAIN_SUFFIX}`;
}

export function isBuiltinVariableKey(key: string): boolean {
  return key === "PORT" || key.startsWith(BUILTIN_VARIABLE_PREFIX);
}

export function builtinVariables(source: BuiltinVariableSource): BuiltinVariable[] {
  const { project, service } = source;
  const variables: BuiltinVariable[] = [
    {
      key: "PORT",
      value: String(service.port),
      description: "Port sur lequel l’application doit écouter.",
    },
    {
      key: "TWINS_PUBLIC_DOMAIN",
      value: source.publicDomain ?? "",
      description: "Nom de domaine public du service (vide tant qu’aucun domaine n’est actif).",
    },
    {
      key: "TWINS_PRIVATE_DOMAIN",
      value: privateDomainOf(service.slug),
      description: "Nom interne pour joindre ce service depuis les autres services du projet.",
    },
    { key: "TWINS_PROJECT_NAME", value: project.name, description: "Nom du projet." },
    { key: "TWINS_PROJECT_ID", value: project.id, description: "Identifiant du projet." },
    { key: "TWINS_SERVICE_NAME", value: service.name, description: "Nom du service." },
    { key: "TWINS_SERVICE_ID", value: service.id, description: "Identifiant du service." },
    {
      key: "TWINS_ENVIRONMENT_NAME",
      value: project.environment,
      description: "Environnement du projet (production).",
    },
    { key: "TWINS_REGION", value: project.region, description: "Région du serveur." },
    {
      key: "TWINS_DEPLOYMENT_ID",
      value: source.deploymentId ?? "",
      description: "Identifiant du déploiement en cours (connu dans le conteneur seulement).",
    },
  ];
  if (service.volume) {
    variables.push(
      { key: "TWINS_VOLUME_NAME", value: service.volume.name, description: "Nom du volume attaché." },
      {
        key: "TWINS_VOLUME_MOUNT_PATH",
        value: service.volume.mountPath,
        description: "Dossier du volume dans le conteneur : les fichiers écrits là survivent aux redéploiements.",
      },
    );
  }
  return variables;
}

interface DomainCandidate {
  hostname: string;
  kind: string;
  status: string;
}

/**
 * The hostname TWINS_PUBLIC_DOMAIN carries: the service's primary domain when
 * known, else the first domain able to serve (custom and verified first, then
 * generated, then local), else null. Deciding from the domains lets the first
 * deployment of a service see its generated domain before it is published.
 */
export function pickPublicDomain(
  primaryDomain: string | null,
  domains: readonly DomainCandidate[],
  isLocal: (hostname: string) => boolean,
): string | null {
  if (primaryDomain) return primaryDomain;
  const rank = (domain: DomainCandidate): number => {
    if (domain.kind === "custom") return domain.status === "active" ? 0 : 3;
    if (domain.kind === "generated") return 1;
    return isLocal(domain.hostname) ? 2 : 4;
  };
  const candidates = domains.filter((domain) => rank(domain) < 3);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => rank(a) - rank(b));
  return candidates[0].hostname;
}
