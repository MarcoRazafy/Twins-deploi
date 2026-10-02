"use client";

import { useState } from "react";
import { toast } from "sonner";

import { isApiError } from "@/lib/api/contract";

import { notifyError } from "../lib/errors";

type Primitive = string | number | boolean;
export type FormValues = Record<string, Primitive>;
export type FormErrors<T extends FormValues> = Partial<Record<keyof T, string>>;

export interface FormControls {
  dirty: boolean;
  saving: boolean;
  reset: () => void;
  submit: () => Promise<void>;
}

export interface SettingsForm<T extends FormValues> extends FormControls {
  values: T;
  errors: FormErrors<T>;
  set: <K extends keyof T>(key: K, value: T[K]) => void;
  /** Validates one field once the user leaves it. */
  blur: (key: keyof T) => void;
}

interface Options<T extends FormValues> {
  initial: T;
  validate: (values: T) => FormErrors<T>;
  save: (values: T) => Promise<unknown>;
  successMessage: string;
  /** Maps an ApiError.field to a form key when the two differ ("dns.serverIp" → "serverIp"). */
  fieldMap?: Record<string, keyof T>;
}

function trimStrings<T extends FormValues>(values: T): T {
  const result: FormValues = {};
  for (const [key, value] of Object.entries(values)) {
    result[key] = typeof value === "string" ? value.trim() : value;
  }
  return result as T;
}

/**
 * Draft state of one settings card. The parent keys the card by the saved
 * data, so a refetch after saving remounts it with the new baseline; the
 * baseline kept here only covers values that normalise to the same data.
 */
export function useSettingsForm<T extends FormValues>({
  initial,
  validate,
  save,
  successMessage,
  fieldMap,
}: Options<T>): SettingsForm<T> {
  const [baseline, setBaseline] = useState<T>(initial);
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<FormErrors<T>>({});
  const [saving, setSaving] = useState(false);

  const dirty = (Object.keys(values) as Array<keyof T>).some((key) => values[key] !== baseline[key]);

  function set<K extends keyof T>(key: K, value: T[K]) {
    const next = { ...values, [key]: value };
    setValues(next);
    // An error already on screen follows the field while it is being fixed.
    if (errors[key]) {
      const found = validate(trimStrings(next));
      setErrors((current) => ({ ...current, [key]: found[key] }));
    }
  }

  function blur(key: keyof T) {
    const found = validate(trimStrings(values));
    setErrors((current) => ({ ...current, [key]: found[key] }));
  }

  function reset() {
    setValues(baseline);
    setErrors({});
  }

  async function submit() {
    if (saving || !dirty) return;
    const cleaned = trimStrings(values);
    const found = validate(cleaned);
    if (Object.values(found).some(Boolean)) {
      setErrors(found);
      return;
    }
    setSaving(true);
    try {
      await save(cleaned);
      setBaseline(cleaned);
      setValues(cleaned);
      setErrors({});
      toast.success(successMessage);
    } catch (error) {
      const target = isApiError(error) && error.field ? (fieldMap?.[error.field] ?? error.field) : null;
      if (target !== null && target in values) {
        setErrors({ [target]: (error as Error).message } as FormErrors<T>);
      } else {
        notifyError(error);
      }
    } finally {
      setSaving(false);
    }
  }

  return { values, errors, dirty, saving, set, blur, reset, submit };
}
