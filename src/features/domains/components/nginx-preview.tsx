"use client";

import { CodeBlock } from "@/components/shared/code-block";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useService, useSettings } from "@/lib/queries";
import type { Domain } from "@/lib/types";

import { buildNginxConfig } from "../lib/nginx-config";

/** Preview of the NGINX server blocks written for a domain, following the platform settings. */
export function NginxPreview({ domain }: { domain: Domain }) {
  const service = useService(domain.serviceId);
  const settings = useSettings();

  if (service.isError || settings.isError) {
    return (
      <ErrorState
        compact
        title="Aperçu indisponible"
        error={service.error ?? settings.error}
        onRetry={() => {
          void service.refetch();
          void settings.refetch();
        }}
      />
    );
  }
  if (!service.data || !settings.data) {
    return <Skeleton aria-busy="true" className="h-72 rounded-lg" />;
  }

  return (
    <CodeBlock
      code={buildNginxConfig({
        domain,
        serviceName: service.data.name,
        settings: settings.data.nginx,
      })}
      title={`/etc/nginx/conf.d/${domain.hostname}.conf`}
      language="nginx"
      maxHeight={420}
    />
  );
}
