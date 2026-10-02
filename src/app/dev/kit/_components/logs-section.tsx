"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser, ListPlus, RotateCcw } from "lucide-react";

import { CodeBlock } from "@/components/shared/code-block";
import { LogViewer } from "@/components/shared/log-viewer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { LogLine } from "@/lib/types";

import { KitExample, KitSection } from "./kit-section";
import { SAMPLE_BASE_TIME, SAMPLE_LOG_LINES, sampleRuntimeLines } from "./sample-data";

const ENV_SNIPPET = `# Variables partagées du projet
DATABASE_URL=\${{Postgres.DATABASE_URL}}
NEXT_PUBLIC_SITE_URL=https://cancham.mg
SMTP_HOST=smtp.mail.mg
# Renseignée par le service worker-emails
SMTP_PASSWORD=\${{shared.SMTP_PASSWORD}}`;

const DNS_SNIPPET = `Type   Nom            Valeur                              TTL
CNAME  app            proxy.mini-railway.app              3600
TXT    _verify.app    mini-railway-verify=7f3a9c21d4e8    3600`;

const SQL_SNIPPET = `-- Adhésions en attente de paiement
SELECT a.id, m.raison_sociale, a.montant, a.echeance
FROM adhesions a
JOIN membres m ON m.id = a.membre_id
WHERE a.statut = 'en_attente'
ORDER BY a.echeance ASC
LIMIT 20;`;

interface LogsSectionProps {
  loading: boolean;
}

export function LogsSection({ loading }: LogsSectionProps) {
  const [lines, setLines] = useState<LogLine[]>(SAMPLE_LOG_LINES);
  const [streaming, setStreaming] = useState(false);
  const sequence = useRef(0);

  // Simulated stream: a few runtime lines every 450 ms while the switch is on.
  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => {
      const batch = 1 + (sequence.current % 3);
      const next = sampleRuntimeLines(batch, Date.now(), `live-${sequence.current}`);
      sequence.current += 1;
      setLines((current) => [...current, ...next]);
    }, 450);
    return () => window.clearInterval(timer);
  }, [streaming]);

  function addBulk() {
    sequence.current += 1;
    setLines((current) => [
      ...current,
      ...sampleRuntimeLines(3000, SAMPLE_BASE_TIME, `bulk-${sequence.current}`),
    ]);
  }

  return (
    <KitSection
      id="logs"
      title="Logs et code"
      description="LogViewer affiche les logs de build, de déploiement et d’exécution : filtre par flux, recherche surlignée, copie, téléchargement, suivi du flux en direct. CodeBlock présente commandes et extraits de configuration."
    >
      <KitExample title="Console de logs" code="<LogViewer />" bodyClassName="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <Switch id="kit-log-stream" checked={streaming} onCheckedChange={setStreaming} />
            <Label htmlFor="kit-log-stream">Simuler un flux en direct</Label>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <Button variant="outline" size="sm" onClick={addBulk}>
              <ListPlus data-icon="inline-start" />
              Ajouter 3 000 lignes
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLines([])}>
              <Eraser data-icon="inline-start" />
              Vider
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLines(SAMPLE_LOG_LINES)}>
              <RotateCcw data-icon="inline-start" />
              Réinitialiser
            </Button>
          </div>
        </div>
        <LogViewer
          lines={lines}
          streaming={streaming}
          loading={loading}
          title="Déploiement de cancham-web"
          showStreamFilter
          downloadName="cancham-web-a1b2c3d"
          height={440}
        />
      </KitExample>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CodeBlock title=".env" language="env" code={ENV_SNIPPET} />
        <CodeBlock title="requete.sql" language="sql" code={SQL_SNIPPET} maxHeight={176} />
        <div className="space-y-4">
          <CodeBlock code="docker pull nginx:1.27-alpine" />
          <CodeBlock code={DNS_SNIPPET} copyable={false} />
        </div>
      </div>
    </KitSection>
  );
}
