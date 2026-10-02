"use client";

import {
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Check } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { getErrorMessage, isApiError, type UpdateVariableInput } from "@/lib/api/contract";
import type { EnvVariable } from "@/lib/types";

import type { VariableActions } from "../hooks/use-variable-actions";
import {
  looksSensitive,
  parseEnv,
  REFERENCE_EXAMPLE,
  suggestKey,
  validateKey,
  type ParsedEnv,
} from "../lib/env";
import { PasteImportPanel } from "./paste-import-panel";

export interface VariableFormProps {
  /** Present when editing an existing variable, absent when creating one. */
  variable?: EnvVariable;
  existingKeys: ReadonlySet<string>;
  actions: VariableActions;
  onClose: () => void;
}

/**
 * Name, value and "Secret" switch. Used above the list to add a variable and
 * in place of a row to edit one, with the same validation: the name is
 * checked on blur and on submit, the API's field errors appear inline.
 */
export function VariableForm({ variable, existingKeys, actions, onClose }: VariableFormProps) {
  const editing = variable !== undefined;
  const keyId = useId();
  const valueId = useId();
  const secretId = useId();
  const keyRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLTextAreaElement>(null);

  const [key, setKey] = useState(variable?.key ?? "");
  const [value, setValue] = useState(variable?.value ?? "");
  // null = follow the name (secret-looking names start sealed) until the user decides.
  const [secretOverride, setSecretOverride] = useState<boolean | null>(
    variable ? variable.isSecret : null,
  );
  const [keyError, setKeyError] = useState<string | null>(null);
  const [valueError, setValueError] = useState<string | null>(null);
  const [keyTouched, setKeyTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pasted, setPasted] = useState<ParsedEnv | null>(null);

  const isSecret = secretOverride ?? looksSensitive(key);
  const suggestion = keyTouched ? suggestKey(key) : "";
  const showSuggestion = suggestion !== "" && suggestion !== key.trim();

  function handleKeyBlur() {
    setKeyTouched(true);
    const trimmed = key.trim();
    if (trimmed) setKeyError(validateKey(trimmed));
  }

  function handleKeyPaste(event: ClipboardEvent<HTMLInputElement>) {
    if (editing) return;
    const text = event.clipboardData.getData("text");
    if (!/[=\n]/.test(text)) return;

    const result = parseEnv(text);
    if (result.entries.length >= 2) {
      event.preventDefault();
      setPasted(result);
    } else if (result.entries.length === 1 && result.issues.length === 0) {
      // A single KEY=value pair fills both fields.
      const [entry] = result.entries;
      event.preventDefault();
      setKey(entry.key);
      setValue(entry.value);
      setKeyError(null);
      setKeyTouched(true);
      valueRef.current?.focus();
    }
  }

  function handleKeyEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const error = validateKey(key.trim());
    if (error) {
      setKeyError(error);
      setKeyTouched(true);
      return;
    }
    valueRef.current?.focus();
  }

  function handleValueEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Shift + Enter keeps its usual meaning: a new line inside the value.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void handleSubmit();
  }

  function handleFormKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Escape") return;
    // Keep the escape for the form: a panel or dialog around it must stay open.
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  function applySuggestion() {
    setKey(suggestion);
    setKeyError(null);
    valueRef.current?.focus();
  }

  async function handleSubmit() {
    if (saving) return;
    const trimmedKey = key.trim();
    const error = validateKey(trimmedKey);
    if (error) {
      setKeyError(error);
      setKeyTouched(true);
      keyRef.current?.focus();
      return;
    }

    setSaving(true);
    try {
      if (variable) {
        const patch: UpdateVariableInput = {};
        if (trimmedKey !== variable.key) patch.key = trimmedKey;
        if (value !== variable.value) patch.value = value;
        if (isSecret !== variable.isSecret) patch.isSecret = isSecret;
        if (Object.keys(patch).length > 0) await actions.update(variable, patch);
      } else {
        await actions.create({ key: trimmedKey, value, isSecret });
      }
      onClose();
    } catch (caught) {
      if (isApiError(caught) && caught.field === "key") {
        setKeyError(caught.message);
        keyRef.current?.focus();
      } else if (isApiError(caught) && caught.field === "value") {
        setValueError(caught.message);
      } else {
        toast.error(getErrorMessage(caught));
      }
    } finally {
      setSaving(false);
    }
  }

  function handleSubmitEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleSubmit();
  }

  return (
    <form
      noValidate
      aria-label={editing ? `Modifier ${variable.key}` : "Nouvelle variable"}
      onSubmit={handleSubmitEvent}
      onKeyDown={handleFormKeyDown}
      className="grid gap-3 p-3 whitespace-normal sm:p-4"
    >
      <AnimatePresence initial={false}>
        {pasted ? (
          <PasteImportPanel
            key="paste-import"
            parsed={pasted}
            existingKeys={existingKeys}
            onImport={actions.importEntries}
            onImported={onClose}
            onDismiss={() => setPasted(null)}
          />
        ) : null}
      </AnimatePresence>

      <div className="grid gap-3 @xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <Field data-invalid={keyError ? "true" : undefined}>
          <FieldLabel htmlFor={keyId}>Nom</FieldLabel>
          <Input
            ref={keyRef}
            id={keyId}
            value={key}
            placeholder="NOM_DE_LA_VARIABLE"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus={!editing}
            aria-invalid={Boolean(keyError)}
            className="font-mono md:text-[13px]"
            onChange={(event) => {
              setKey(event.target.value);
              setKeyError(null);
              setKeyTouched(false);
            }}
            onBlur={handleKeyBlur}
            onPaste={handleKeyPaste}
            onKeyDown={handleKeyEnter}
          />
          {keyError ? <FieldError>{keyError}</FieldError> : null}
          {showSuggestion ? (
            <p className="text-xs text-muted-foreground">
              Nom conventionnel :{" "}
              <Button
                type="button"
                variant="link"
                size="xs"
                className="h-auto p-0 font-mono text-xs"
                onClick={applySuggestion}
              >
                {suggestion}
              </Button>
            </p>
          ) : null}
        </Field>

        <Field data-invalid={valueError ? "true" : undefined}>
          <FieldLabel htmlFor={valueId}>Valeur</FieldLabel>
          <Textarea
            ref={valueRef}
            id={valueId}
            value={value}
            rows={1}
            placeholder="Valeur"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus={editing}
            aria-invalid={Boolean(valueError)}
            className="max-h-60 min-h-8 overflow-y-auto py-1.5 font-mono md:text-[13px]"
            onChange={(event) => {
              setValue(event.target.value);
              setValueError(null);
            }}
            onKeyDown={handleValueEnter}
          />
          {valueError ? (
            <FieldError>{valueError}</FieldError>
          ) : (
            <FieldDescription className="text-xs">
              Entrée pour valider, Maj + Entrée pour un retour à la ligne. Référence :{" "}
              <code className="font-mono">{REFERENCE_EXAMPLE}</code>
            </FieldDescription>
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Field orientation="horizontal" className="w-auto">
          <Switch
            id={secretId}
            checked={isSecret}
            onCheckedChange={setSecretOverride}
            disabled={saving}
          />
          <FieldLabel htmlFor={secretId}>Secret</FieldLabel>
        </Field>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
            {editing ? "Enregistrer" : "Ajouter"}
          </Button>
        </div>
      </div>
    </form>
  );
}
