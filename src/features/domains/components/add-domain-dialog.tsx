"use client";

import { useId, useState, type FormEvent } from "react";
import { Globe, Plus, Sparkles, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";

import { ServiceSelect } from "@/components/shared/service-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getErrorMessage, isApiError } from "@/lib/api/contract";
import { slugify } from "@/lib/format";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import {
  useCreateDomain,
  useDomains,
  useGenerateDomain,
  useProjects,
  useServices,
  useSettings,
} from "@/lib/queries";
import type { Domain, ServiceType } from "@/lib/types";

import {
  normalizeHostname,
  parsePort,
  PORT_ERROR,
  validateHostname,
} from "../lib/domain-utils";
import { DnsRecordsPanel } from "./dns-records-panel";
import { DomainStepper } from "./domain-stepper";

export interface AddDomainDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselects the target service. */
  defaultServiceId?: string;
  onCreated?: (domain: Domain) => void;
}

type DomainMode = "generated" | "custom";

interface DomainDialogProps extends AddDomainDialogProps {
  /** Keeps the service picker on `defaultServiceId` (dialog opened from a service panel). */
  lockService?: boolean;
  /** Segment selected on opening (default "generated"). */
  initialMode?: DomainMode;
}

/** Databases are not exposed over HTTP. */
const EXPOSABLE_TYPES: ServiceType[] = ["github", "docker"];

const MODES = [
  { value: "generated", label: "Domaine généré", icon: Sparkles },
  { value: "custom", label: "Domaine personnalisé", icon: Globe },
] as const satisfies ReadonlyArray<{ value: DomainMode; label: string; icon: LucideIcon }>;

function isDomainMode(value: string): value is DomainMode {
  return value === "generated" || value === "custom";
}

/** Segmented control: the pill glides to the chosen segment. */
function ModeSwitch({ value, onChange }: { value: DomainMode; onChange: (mode: DomainMode) => void }) {
  const pillId = useId();

  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        // Clicking the active segment reports an empty value: keep the current mode.
        if (isDomainMode(next)) onChange(next);
      }}
      spacing={1}
      aria-label="Type de domaine"
      className="grid w-full grid-cols-2 rounded-lg bg-secondary p-1"
    >
      {MODES.map((mode) => {
        const Icon = mode.icon;
        return (
          <ToggleGroupItem
            key={mode.value}
            value={mode.value}
            className="relative h-8 w-full min-w-0 gap-1.5 rounded-md px-1 text-[13px] text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-transparent data-[state=on]:text-foreground sm:px-2 sm:text-sm"
          >
            {value === mode.value ? (
              <motion.span
                layoutId={pillId}
                transition={SPRING.snappy}
                aria-hidden="true"
                className="absolute inset-0 rounded-md border border-border-strong bg-card"
              />
            ) : null}
            <span className="relative inline-flex min-w-0 items-center gap-1.5">
              <Icon aria-hidden="true" className="hidden sm:block" />
              <span className="truncate">{mode.label}</span>
            </span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

function GeneratedPanel({ serviceName }: { serviceName: string | null }) {
  const settings = useSettings();
  const slug = serviceName ? slugify(serviceName) : "service";

  return (
    <div className="space-y-3 rounded-lg bg-secondary p-3">
      <p className="text-sm text-muted-foreground">
        Un domaine HTTPS est créé et activé immédiatement : aucune configuration DNS n’est
        nécessaire. Le nom suit le format service-production-xxxx, suivi du domaine de base de la
        plateforme.
      </p>
      <div className="flex flex-wrap items-center rounded-md border bg-background px-3 py-2 font-mono text-[13px] break-all">
        <span>{slug}-production-</span>
        <span className="text-brand-400">xxxx</span>
        {settings.data ? (
          <span className="text-muted-foreground">.{settings.data.baseDomain}</span>
        ) : (
          <Skeleton className="ml-0.5 h-4 w-28" />
        )}
      </div>
    </div>
  );
}

interface FieldErrors {
  service?: string;
  hostname?: string;
  port?: string;
}

interface CreateStepProps {
  defaultServiceId?: string;
  lockService: boolean;
  initialMode: DomainMode;
  onCreated: (domain: Domain) => void;
  onCancel: () => void;
}

function CreateStep({ defaultServiceId, lockService, initialMode, onCreated, onCancel }: CreateStepProps) {
  const baseId = useId();
  const serviceFieldId = `${baseId}-service`;
  const hostnameFieldId = `${baseId}-hostname`;
  const portFieldId = `${baseId}-port`;

  const [serviceId, setServiceId] = useState<string | null>(defaultServiceId ?? null);
  const [mode, setMode] = useState<DomainMode>(initialMode);
  const [hostname, setHostname] = useState("");
  // null = follow the port of the chosen service until the user types one.
  const [portInput, setPortInput] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const services = useServices();
  const projects = useProjects();
  const generate = useGenerateDomain();
  const create = useCreateDomain();

  const exposable = (services.data ?? []).filter((item) => item.source.type !== "postgres");
  const service = exposable.find((item) => item.id === serviceId);
  const project = service ? projects.data?.find((item) => item.id === service.projectId) : undefined;
  const portValue = portInput ?? (service ? String(service.config.port) : "");
  const pending = generate.isPending || create.isPending;
  const nothingToExpose = services.isSuccess && exposable.length === 0;

  function reportError(error: unknown) {
    if (isApiError(error)) {
      if (error.field === "hostname") {
        setErrors({ hostname: error.message });
        return;
      }
      if (error.field === "targetPort") {
        setErrors({ port: error.message });
        return;
      }
      if (error.field === "serviceId") {
        setErrors({ service: error.message });
        return;
      }
    }
    toast.error(getErrorMessage(error));
  }

  function validateHostnameField() {
    if (!hostname.trim()) return;
    const normalized = normalizeHostname(hostname);
    setHostname(normalized);
    setErrors((current) => ({ ...current, hostname: validateHostname(normalized) ?? undefined }));
  }

  function validatePortField() {
    setErrors((current) => ({
      ...current,
      port: parsePort(portValue) === null ? PORT_ERROR : undefined,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!service) {
      setErrors({ service: "Choisissez le service à exposer." });
      return;
    }

    if (mode === "generated") {
      try {
        const domain = await generate.mutateAsync(service.id);
        toast.success("Domaine généré", { description: domain.hostname });
        onCreated(domain);
      } catch (error) {
        reportError(error);
      }
      return;
    }

    const normalized = normalizeHostname(hostname);
    const hostnameError = validateHostname(normalized);
    const port = parsePort(portValue);
    if (hostnameError || port === null) {
      setHostname(normalized);
      setErrors({ hostname: hostnameError ?? undefined, port: port === null ? PORT_ERROR : undefined });
      return;
    }
    try {
      const domain = await create.mutateAsync({
        serviceId: service.id,
        hostname: normalized,
        targetPort: port,
      });
      toast.success("Domaine ajouté", {
        description: `${domain.hostname} · configurez maintenant le DNS.`,
      });
      onCreated(domain);
    } catch (error) {
      reportError(error);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Ajouter un domaine</DialogTitle>
        <DialogDescription>
          Exposez un service sur Internet avec un domaine généré ou avec le vôtre.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-4">
        <Field data-invalid={errors.service ? true : undefined}>
          <FieldLabel htmlFor={serviceFieldId}>Service</FieldLabel>
          <ServiceSelect
            id={serviceFieldId}
            types={EXPOSABLE_TYPES}
            value={serviceId}
            onChange={(next) => {
              setServiceId(next);
              setErrors((current) => ({ ...current, service: undefined }));
            }}
            disabled={lockService}
            className="w-full"
          />
          {service ? (
            <FieldDescription>
              {project ? `${project.name} · ` : null}écoute sur le port {service.config.port}
            </FieldDescription>
          ) : nothingToExpose ? (
            <FieldDescription>
              Aucun service ne peut être exposé : ajoutez d’abord un service GitHub ou Docker à un
              projet.
            </FieldDescription>
          ) : null}
          <FieldError>{errors.service}</FieldError>
        </Field>

        <ModeSwitch
          value={mode}
          onChange={(next) => {
            setMode(next);
            setErrors((current) => ({ ...current, hostname: undefined, port: undefined }));
          }}
        />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } }}
            exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
          >
            {mode === "generated" ? (
              <GeneratedPanel serviceName={service?.name ?? null} />
            ) : (
              <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                <Field data-invalid={errors.hostname ? true : undefined}>
                  <FieldLabel htmlFor={hostnameFieldId}>Nom de domaine</FieldLabel>
                  <Input
                    id={hostnameFieldId}
                    value={hostname}
                    placeholder="app.exemple.mg"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode="url"
                    aria-invalid={Boolean(errors.hostname)}
                    onChange={(event) => {
                      setHostname(event.target.value.toLowerCase());
                      if (errors.hostname) setErrors((current) => ({ ...current, hostname: undefined }));
                    }}
                    onBlur={validateHostnameField}
                    className="font-mono text-[13px] md:text-[13px]"
                  />
                  <FieldDescription>
                    Nom complet, sous-domaine compris. Démo : un nom en .invalid simule un échec DNS.
                  </FieldDescription>
                  <FieldError>{errors.hostname}</FieldError>
                </Field>
                <Field data-invalid={errors.port ? true : undefined}>
                  <FieldLabel htmlFor={portFieldId}>Port cible</FieldLabel>
                  <Input
                    id={portFieldId}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={65535}
                    value={portValue}
                    aria-invalid={Boolean(errors.port)}
                    onChange={(event) => {
                      setPortInput(event.target.value);
                      if (errors.port) setErrors((current) => ({ ...current, port: undefined }));
                    }}
                    onBlur={validatePortField}
                    className="font-mono tabular"
                  />
                  <FieldDescription>Par défaut, celui du service.</FieldDescription>
                  <FieldError>{errors.port}</FieldError>
                </Field>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </FieldGroup>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending || nothingToExpose}>
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : mode === "generated" ? (
            <Sparkles data-icon="inline-start" />
          ) : (
            <Plus data-icon="inline-start" />
          )}
          {mode === "generated" ? "Générer le domaine" : "Ajouter le domaine"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Second step of a custom domain: the records to create and the live verification. */
function DnsStep({ domain, onClose }: { domain: Domain; onClose: () => void }) {
  const live = useDomains({ serviceId: domain.serviceId });
  const current = live.data?.find((item) => item.id === domain.id) ?? domain;

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Configurer le DNS</DialogTitle>
        <DialogDescription>
          Créez ces enregistrements chez votre registrar pour{" "}
          <span className="font-mono text-foreground">{current.hostname}</span>, puis lancez la
          vérification.
        </DialogDescription>
      </DialogHeader>

      <DomainStepper domain={current} />
      <DnsRecordsPanel domain={current} />

      <DialogFooter>
        <Button
          type="button"
          variant={current.status === "active" ? "default" : "outline"}
          onClick={onClose}
        >
          {current.status === "active" ? "Terminer" : "Terminer plus tard"}
        </Button>
      </DialogFooter>
    </div>
  );
}

interface DomainDialogBodyProps {
  defaultServiceId?: string;
  lockService: boolean;
  initialMode: DomainMode;
  onCreated?: (domain: Domain) => void;
  onClose: () => void;
}

/** Lives inside the dialog content, so its state starts fresh each time the dialog opens. */
function DomainDialogBody({
  defaultServiceId,
  lockService,
  initialMode,
  onCreated,
  onClose,
}: DomainDialogBodyProps) {
  const [created, setCreated] = useState<Domain | null>(null);

  if (created) return <DnsStep domain={created} onClose={onClose} />;

  return (
    <CreateStep
      defaultServiceId={defaultServiceId}
      lockService={lockService}
      initialMode={initialMode}
      onCancel={onClose}
      onCreated={(domain) => {
        onCreated?.(domain);
        // A generated domain is live at once; a custom one needs its DNS records.
        if (domain.kind === "custom") setCreated(domain);
        else onClose();
      }}
    />
  );
}

/** Add dialog with the options only the service panel needs (locked service, opening mode). */
export function DomainDialog({
  open,
  onOpenChange,
  defaultServiceId,
  lockService = false,
  initialMode = "generated",
  onCreated,
}: DomainDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DomainDialogBody
          defaultServiceId={defaultServiceId}
          lockService={lockService}
          initialMode={initialMode}
          onCreated={onCreated}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Adds a domain to a service: generated (live at once) or custom (then the DNS
 * records and the live verification). Controlled, so any page can open it.
 */
export function AddDomainDialog(props: AddDomainDialogProps) {
  return <DomainDialog {...props} />;
}
