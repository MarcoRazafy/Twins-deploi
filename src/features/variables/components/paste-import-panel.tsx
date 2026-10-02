"use client";

import { useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage } from "@/lib/api/contract";
import { pluralize } from "@/lib/format";
import { DURATION, EASE } from "@/lib/motion";

import type { ParsedEnv } from "../lib/env";

const MAX_LISTED_KEYS = 8;

export interface PasteImportPanelProps {
  parsed: ParsedEnv;
  existingKeys: ReadonlySet<string>;
  onImport: (entries: ReadonlyArray<{ key: string; value: string }>) => Promise<void>;
  /** Called once the import succeeded. */
  onImported: () => void;
  onDismiss: () => void;
}

/** Offered when several KEY=value lines are pasted into the name field. */
export function PasteImportPanel({
  parsed,
  existingKeys,
  onImport,
  onImported,
  onDismiss,
}: PasteImportPanelProps) {
  const [saving, setSaving] = useState(false);

  // The last occurrence of a key wins, like in a .env file.
  const unique = new Map<string, string>();
  for (const entry of parsed.entries) {
    unique.delete(entry.key);
    unique.set(entry.key, entry.value);
  }
  const entries = Array.from(unique, ([key, value]) => ({ key, value }));
  const total = entries.length;
  const replaced = entries.filter(({ key }) => existingKeys.has(key)).length;
  const created = total - replaced;
  const ignored = parsed.issues.length;

  const details = [
    created > 0 ? `${created} à ajouter` : "",
    replaced > 0 ? `${replaced} à remplacer` : "",
    ignored > 0 ? `${pluralize(ignored, "ligne")} ignorée${ignored > 1 ? "s" : ""}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  async function handleImport() {
    setSaving(true);
    try {
      await onImport(entries);
      onImported();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } }}
      exit={{ opacity: 0, transition: { duration: DURATION.fast, ease: EASE.out } }}
      className="flex items-start gap-3 rounded-lg border border-brand-600/25 bg-brand-600/10 p-3"
    >
      <ClipboardPaste className="mt-0.5 size-4 shrink-0 text-brand-400" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {pluralize(total, "variable")} {total > 1 ? "détectées" : "détectée"} dans le texte collé
          </p>
          {details ? <p className="text-xs text-muted-foreground">{details}</p> : null}
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {entries.slice(0, MAX_LISTED_KEYS).map(({ key }) => (
            <li key={key}>
              <code className="rounded-md border bg-card px-1.5 py-0.5 font-mono text-xs">
                {key}
              </code>
            </li>
          ))}
          {total > MAX_LISTED_KEYS ? (
            <li className="px-1 py-0.5 text-xs text-muted-foreground">
              +{total - MAX_LISTED_KEYS}
            </li>
          ) : null}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={handleImport}>
            {saving ? <Spinner data-icon="inline-start" /> : null}
            {total > 1 ? `Importer ${total} variables` : "Importer la variable"}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onDismiss}>
            Ignorer
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
